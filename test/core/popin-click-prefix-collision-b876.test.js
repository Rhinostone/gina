'use strict';
/**
 * #B876 (gh#86) — a popin's document click proxy claims only its OWN triggers.
 *
 * Each `new Popin()` registers a document click listener whose predicate is the cached
 * `_rePopinClick` (popin/main.js), built from the instance id. Instance ids are
 * `'gina-popins-' + _nextId()`, where `_nextId()` reads one shared counter (`gina-popins-gp-1`,
 * `gina-popins-gp-14`, …), and every engine-built click trigger id is
 * `popin.click.gina-popin-<instance.id>-<_nextId()>-<name>`. Built with no delimiter after the
 * instance id, the regex of `gina-popins-gp-1` also matched the triggers of `gina-popins-gp-14`
 * (and `gp-2` those of `gp-22`), so one click fired two proxies: the popin loaded twice and the
 * second load replaced the bound form, which then submitted natively. The fix appends the `-`
 * delimiter to the instance id in the regex.
 *
 * These tests drive the REAL construction from the shipped bytes, the source AND the built dist,
 * never a retyped copy: the `new RegExp(…)` argument is sliced out of the file and evaluated with
 * an explicit `instance` (it reads nothing else, so lifting it is faithful). The ids are built the
 * way the source builds them: the instance-id prefix and the trigger-id expression are read from
 * the source, and `_nextId`'s output shape is parsed from its definition (the function itself is
 * not lifted: it reads the closure variable `_uid`, which a lifted copy cannot see). Every live
 * instance's regex is then run against one clicked trigger id, the way the document click handler
 * decides which proxy fires `triggerEvent`.
 * Red-first: on the pre-fix bytes the collision arms count 2 (or 3) claims for one click; on the
 * fix, exactly 1. Seams: B876_POPIN_SRC=<popin/main.js>, B876_PLUGIN_DIST=<dist/vendor/gina/js>.
 * A published npm package ships only `dist/`, not the plugin `src/` tree: to check a published
 * version, take `popin/main.js` from the matching git tag for B876_POPIN_SRC (the ids are built
 * from it) and point B876_PLUGIN_DIST at the package's own dist.
 *
 * Run standalone:
 *   node --test test/core/popin-click-prefix-collision-b876.test.js
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs   = require('fs');
var path = require('path');

var FW        = require('../fw');
var POPIN_SRC = process.env.B876_POPIN_SRC || path.join(FW, 'core/asset/plugin/src/vendor/gina/popin/main.js');
var DIST_DIR  = process.env.B876_PLUGIN_DIST || path.join(FW, 'core/asset/plugin/dist/vendor/gina/js');

var _cache = {};
function read(p) { return _cache[p] || (_cache[p] = fs.readFileSync(p, 'utf8')); }

// The cached per-instance regex is the only `new RegExp('^popin\\.click\\.gina-popin-'…)` with
// ESCAPED dots; the generic trigger check (`RegExp('^popin.click.gina-popin-')`) has unescaped
// dots and no instance id, so this needle never matches it.
var NEEDLE = "new RegExp('^popin\\\\.click\\\\.gina-popin-'";

/**
 * Every cached-regex construction in `text`, as { arg, varName } — `arg` is the RegExp argument
 * expression exactly as written in the file, `varName` the identifier whose `.id` it reads
 * (`instance` in the source, a minified name in the dist).
 * @param {string} text
 * @returns {Array<{arg: string, varName: string}>}
 */
function extractConstructions(text) {
    var out = [], from = 0, idx;
    while ((idx = text.indexOf(NEEDLE, from)) > -1) {
        var open  = idx + 'new RegExp('.length;
        var close = text.indexOf(')', open);
        var arg   = text.slice(open, close);
        var m     = arg.match(/\+\s*([A-Za-z_$][\w$]*)\.id\b/);
        out.push({ arg: arg, varName: m ? m[1] : null });
        from = close;
    }
    return out;
}

/**
 * Evaluate a sliced construction for one instance id.
 * @param {{arg: string, varName: string}} c
 * @param {string} instanceId
 * @returns {RegExp}
 */
function buildRegex(c, instanceId) {
    return new Function(c.varName, 'return new RegExp(' + c.arg + ');')({ id: instanceId });
}

/**
 * The shape of `_nextId()`'s output, parsed from its definition
 * (`function _nextId(prefix) { return (prefix || '<p>') + '<sep>' + (++_uid); }`).
 * @returns {{prefix: string, sep: string}}
 */
function nextIdShape() {
    var m = read(POPIN_SRC).match(/function\s+_nextId\s*\(\s*prefix\s*\)\s*\{\s*return\s*\(\s*prefix\s*\|\|\s*'([^']+)'\s*\)\s*\+\s*'([^']*)'\s*\+\s*\(\s*\+\+\s*_uid\s*\)\s*;?\s*\}/);
    assert.ok(m, '_nextId is found with its `(prefix || \'<p>\') + \'<sep>\' + (++_uid)` shape');
    return { prefix: m[1], sep: m[2] };
}

/** What `_nextId()` returns when the shared counter reaches `n`. */
function nextIdOf(n) { var s = nextIdShape(); return s.prefix + s.sep + n; }

/** The instance id the source builds when the counter reaches `n` (`id : '<prefix>' + _nextId()`). */
function instanceId(n) {
    var m = read(POPIN_SRC).match(/\bid\s*:\s*'([^']+)'\s*\+\s*_nextId\(\)/);
    assert.ok(m, 'the instance id assignment (id : \'<prefix>\' + _nextId()) is found in the source');
    return m[1] + nextIdOf(n);
}

/** The source's own trigger-id expression (`evt = 'popin.click.'+ 'gina-popin-' + instance.id … ;`), evaluated. */
function triggerIdBuilder() {
    var m = read(POPIN_SRC).match(/evt\s*=\s*('popin\.click\.'\s*\+\s*'gina-popin-'\s*\+\s*instance\.id[^;]*);/);
    assert.ok(m, 'the click trigger id expression is found in the source');
    var fn = new Function('instance', '_nextId', 'name', 'return ' + m[1] + ';');
    return function (ownerId, counter, name) { return fn({ id: ownerId }, function () { return nextIdOf(counter); }, name); };
}

/**
 * How many of the live instances' proxies claim one click, as the document click handler decides:
 * the generic `^popin\.click\.` gate, then the instance's own cached regex.
 */
function claims(construction, liveIds, clickedId) {
    return liveIds.filter(function (iid) {
        return /^popin\.click\./.test(clickedId) && buildRegex(construction, iid).test(clickedId);
    }).length;
}

function scenarios() {
    return [
        { name: 'the reporter\'s case: instance gp-1 vs instance gp-14', live: [instanceId(1), instanceId(14)], owner: instanceId(14) },
        { name: 'instance gp-2 vs instance gp-22',                     live: [instanceId(2), instanceId(22)], owner: instanceId(22) },
        { name: 'a prefix chain: gp-3, gp-30, gp-300',                 live: [instanceId(3), instanceId(30), instanceId(300)], owner: instanceId(300) }
    ];
}

function assertOwnerOnly(construction, label) {
    var trigger = triggerIdBuilder();
    scenarios().forEach(function (s) {
        var clicked = trigger(s.owner, 315, 'myPopin');
        assert.equal(claims(construction, s.live, clicked), 1,
            label + ', ' + s.name + ': exactly one proxy claims a click on ' + clicked);
    });
}

describe('#B876 — a popin click proxy claims only its own triggers (gh#86)', function () {

    describe('the source', function () {

        it('01 - carries exactly one cached _rePopinClick construction reading instance.id, and the id builders are found (extractor guards)', function () {
            var found = extractConstructions(read(POPIN_SRC));
            assert.equal(found.length, 1, 'one cached-regex construction in the source (got ' + found.length + ')');
            assert.equal(found[0].varName, 'instance');
            // the ids the tests click are the engine's own: gina-popins-gp-<n>, triggers built by the source expression
            assert.equal(instanceId(14), 'gina-popins-gp-14', 'instance ids are \'gina-popins-\' + _nextId()');
            assert.match(triggerIdBuilder()(instanceId(14), 315, 'myPopin'), /^popin\.click\.gina-popin-gina-popins-gp-14-gp-315-myPopin$/);
        });

        it('02 - the instance id is followed by the `-` delimiter in the cached regex', function () {
            var c = extractConstructions(read(POPIN_SRC))[0];
            assert.match(c.arg, /\.id\s*\+\s*'-'\s*$/, 'the regex argument ends with + \'-\' after the instance id: ' + c.arg);
        });

        it('03 - one click on a later instance\'s trigger is claimed by that instance alone (gp-1 vs gp-14, gp-2 vs gp-22, gp-3/30/300)', function () {
            assertOwnerOnly(extractConstructions(read(POPIN_SRC))[0], 'source');
        });

        it('04 - controls: the short-id instance still claims its own trigger, and an unrelated instance claims nothing', function () {
            var c = extractConstructions(read(POPIN_SRC))[0], trigger = triggerIdBuilder();
            // the owner with the SHORT id keeps exactly its own click (no under-match)
            assert.equal(claims(c, [instanceId(1), instanceId(14)], trigger(instanceId(1), 315, 'myPopin')), 1);
            // an instance whose id is not a prefix of the owner's never claims it (the instrument reads 0)
            assert.equal(claims(c, [instanceId(9)], trigger(instanceId(14), 315, 'myPopin')), 0);
            // the owner alone reads 1 (the instrument reads 1)
            assert.equal(claims(c, [instanceId(14)], trigger(instanceId(14), 315, 'myPopin')), 1);
        });
    });

    describe('the built dist (what browsers run)', function () {

        ['gina.js', 'gina.min.js'].forEach(function (file, i) {
            var n = String(5 + i * 2).padStart(2, '0'), m = String(6 + i * 2).padStart(2, '0');

            it(n + ' - ' + file + ' carries exactly one cached-regex construction, with the `-` delimiter', function () {
                var found = extractConstructions(read(path.join(DIST_DIR, file)));
                assert.equal(found.length, 1, file + ': one cached-regex construction (got ' + found.length + ')');
                assert.ok(found[0].varName, file + ': the construction reads an identifier\'s .id');
                assert.match(found[0].arg, /\.id\s*\+\s*'-'\s*$/, file + ': the regex argument ends with + \'-\': ' + found[0].arg);
            });

            it(m + ' - ' + file + ': one click on a later instance\'s trigger is claimed by that instance alone', function () {
                assertOwnerOnly(extractConstructions(read(path.join(DIST_DIR, file)))[0], file);
            });
        });
    });
});
