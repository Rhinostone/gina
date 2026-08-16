/**
 * lib/cmd/helper.js loadAssets() — manifest ↔ disk bundle reconciliation on
 * `project:add` / `project:import` (#B375, #B376).
 *
 * #B375 — loadAssets used to carry an "additional checks" block that compared
 * each registered project's declared bundle COUNT against a readdir of
 * `<project>/src` (else `/releases`) and, on ANY mismatch, emptied
 * `manifest.bundles` and wrote it back to disk — for EVERY registered project,
 * not just the one being added/imported. That destroyed every per-bundle
 * declaration the recreation skeleton does not carry (the `scopes` allow-list,
 * `gina_version`, custom keys), reset `version`/`tag`/release targets to
 * defaults, permanently emptied bystander projects' manifests (no rebuild ever
 * runs for a non-target project) and did the same on plain `project:add` (the
 * rebuild is import-only). The fix retires the destructive block (kept
 * commented per the replace-don't-delete convention) and converts the
 * end-of-loadAssets rescan into a UNION: manifest-declared bundles keep their
 * entries untouched, disk-only bundles are appended for additive registration
 * (#B55), and a declared bundle whose tree is absent is warned about once per
 * command — never auto-pruned.
 *
 * #B376 — the rescan loop mutated its scan root across iterations
 * (`_bundleConfigPath` grew by one segment per bundle), so every bundle after
 * the first got a `configPaths.settings` path nested under its predecessors.
 * Fixed by deriving the path from the loop-invariant root for every bundle.
 *
 * Source-inspection pins + pure-logic replicas (same style as
 * project-import.test.js): the handler runs in the CLI daemon/offline context
 * and mutates a project's manifest.json, so the pins prove the source
 * structure and the replicas prove the loop semantics — including a SUBTRACT
 * arm running the OLD accumulate-and-replace logic on identical input to show
 * the assertions discriminate.
 *
 * Comment-stripping note: the retired #B375 block is deliberately PRESERVED as
 * a line-comment in helper.js, so every negative pin below evaluates the
 * ACTIVE source (line-leading comments stripped) and pairs with a raw-text
 * presence check proving both that the strip fired and that the documentation
 * copy survives. Red-first validated against the pre-fix source via
 * `git show` (see the arc's ledger entry for the recorded split).
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var HELPER_SOURCE = path.join(require('../fw'), 'lib/cmd/helper.js');
var ADD_SOURCE    = path.join(require('../fw'), 'lib/cmd/project/add.js');

var helperRaw = fs.readFileSync(HELPER_SOURCE, 'utf8');
var addRaw    = fs.readFileSync(ADD_SOURCE, 'utf8');

// Line-leading comment strip — the ACTIVE source. Deliberately NOT a generic
// comment parser: it must not touch `https://` inside string literals, and the
// retired block is line-commented, which this shape matches exactly.
function stripLineComments(src) {
    return src
        .split('\n')
        .filter(function (l) { return !/^\s*\/\//.test(l); })
        .join('\n');
}

var helperActive = stripLineComments(helperRaw);
var addActive    = stripLineComments(addRaw);


// ---------------------------------------------------------------------------
// 01 — #B375: the destructive manifest reset is retired from the active source
// ---------------------------------------------------------------------------

describe('01 - #B375 wipe retirement (helper.js)', function () {

    it('active source no longer empties manifest.bundles', function () {
        assert.equal(helperActive.indexOf('updatedManifest'), -1,
            'an active `updatedManifest` reference means the destructive reset is back');
    });

    it('active source no longer carries the count-mismatch gate', function () {
        assert.equal(helperActive.indexOf('_count != bundlesCount'), -1);
    });

    it('raw source preserves the retired block as documentation (strip control)', function () {
        // Also proves stripLineComments actually removed something: the same
        // needle reads present raw and absent active.
        assert.ok(helperRaw.indexOf('updatedManifest.bundles = {}') > -1,
            'the retired block should stay in place as a line-comment');
    });
});


// ---------------------------------------------------------------------------
// 02 — #B375: the rescan gate is a union, no longer gated on an empty list
// ---------------------------------------------------------------------------

describe('02 - union rescan gate (helper.js)', function () {

    // The rescan gate's fixed shape: task regex AND the project-defined check,
    // closing right after — with no `!cmd.bundles.length` third condition.
    // (`!cmd.bundles.length` still legitimately exists elsewhere in the file,
    // on a `bundle:` task gate, so the pin matches the CONJUNCTION, not the
    // bare token.)
    var unionGate = /\/\^project\\:\(add\|import\)\/\.test\(cmd\.task\)\s*&&\s*typeof\(cmd\.projects\[cmd\.projectName\]\)\s*!=\s*'undefined'\s*\)/;
    var lengthGate = /typeof\(cmd\.projects\[cmd\.projectName\]\)\s*!=\s*'undefined'\s*&&\s*!cmd\.bundles\.length/;

    it('the add|import rescan runs unconditionally for the current project', function () {
        assert.match(helperActive, unionGate);
    });

    it('the rescan is no longer reserved for an emptied bundle list', function () {
        assert.doesNotMatch(helperActive, lengthGate);
    });

    it('manifest-declared bundles are skipped, not recreated (union dedup)', function () {
        assert.ok(helperActive.indexOf('cmd.bundles.indexOf(name) > -1') > -1);
    });
});


// ---------------------------------------------------------------------------
// 03 — #B376: per-bundle settings path from the loop-invariant scan root
// ---------------------------------------------------------------------------

describe('03 - #B376 settings path derivation (helper.js)', function () {

    it('the scan root is never mutated across iterations', function () {
        // raw on purpose: the fix comment describes the old defect without
        // carrying the accumulating expression, so even the raw text is clean.
        assert.equal(helperRaw.indexOf('_bundleConfigPath += '), -1);
    });

    it('each bundle path is composed from the invariant root + its own name', function () {
        assert.ok(helperActive.indexOf("_bundleConfigPath +'/'+ name +'/config/settings.json'") > -1);
    });
});


// ---------------------------------------------------------------------------
// 04 — #B375: declared-but-absent bundles warn once, never auto-pruned
// ---------------------------------------------------------------------------

describe('04 - declared-but-absent warning (helper.js)', function () {

    it('a declared bundle missing on disk is surfaced, keeping the declaration', function () {
        assert.ok(helperActive.indexOf('keeping the declaration') > -1);
    });

    it('the warning is deduplicated per command via cmd state', function () {
        // shape seed + guard read + set — at least the guard and set must be active
        var count = helperActive.split('warnedAbsentBundles').length - 1;
        assert.ok(count >= 2, 'expected the dedup key to be read and written, saw ' + count + ' active reference(s)');
    });
});


// ---------------------------------------------------------------------------
// 05 — #B375: addBundlePorts tolerates declared-but-absent bundles (add.js)
// ---------------------------------------------------------------------------

describe('05 - settings-consistency guard (add.js)', function () {

    it('a bundle without configPaths is skipped instead of dereferenced', function () {
        assert.ok(addActive.indexOf('( bundleConfig && bundleConfig.configPaths )') > -1);
    });

    it('the exists probe only runs with a resolvable settings path', function () {
        assert.ok(addActive.indexOf('settingsPath && fs.existsSync(settingsPath)') > -1);
    });
});


// ---------------------------------------------------------------------------
// 06 — pure-logic replica of the union rescan (with a subtract arm)
// ---------------------------------------------------------------------------

// Faithful replica of the FIXED loop semantics: names already declared are
// kept, disk-only names are appended with a path derived from the invariant
// root, declared names missing from disk are warned (once).
function unionRescan(declaredNames, diskNames, root) {
    var bundles = declaredNames.slice(0);
    var entries = {};
    var warns   = [];
    var diskSeen = [];
    for (var f = 0; f < diskNames.length; ++f) {
        var name = diskNames[f];
        if (/^\./.test(name)) continue;
        diskSeen.push(name);
        if (bundles.indexOf(name) > -1) continue;
        bundles.push(name);
        entries[name] = { src: 'src/' + name, settings: root + '/' + name + '/config/settings.json' };
    }
    for (var d = 0; d < declaredNames.length; ++d) {
        if (diskSeen.indexOf(declaredNames[d]) < 0) warns.push(declaredNames[d]);
    }
    bundles.sort();
    return { bundles: bundles, entries: entries, warns: warns };
}

// The OLD pipeline on the same input: the count-mismatch wipe discarded the
// declared set, then the rescan recreated every disk name while GROWING the
// root by one segment per iteration.
function oldWipeAndRescan(declaredNames, diskNames, root) {
    var bundles = [];             // the wipe emptied cmd.bundles
    var entries = {};
    var acc = root;               // the accumulating scan root
    for (var f = 0; f < diskNames.length; ++f) {
        var name = diskNames[f];
        if (/^\./.test(name)) continue;
        bundles.push(name);
        acc += '/' + name;
        entries[name] = { settings: acc + '/config/settings.json' };
    }
    bundles.sort();
    return { bundles: bundles, entries: entries, warns: [] };
}

describe('06 - union rescan replica', function () {

    var declared = ['a', 'b', 'x'];          // x: declared, tree absent
    var disk     = ['.DS_Store', 'a', 'b', 'c']; // c: on disk, undeclared
    var root     = '/p/src';

    it('unions manifest and disk without recreating declared entries', function () {
        var r = unionRescan(declared, disk, root);
        assert.deepEqual(r.bundles, ['a', 'b', 'c', 'x']);
        assert.deepEqual(Object.keys(r.entries), ['c'],
            'only the disk-only bundle gets a fresh entry — declared ones stay untouched');
    });

    it('derives every fresh path from the invariant root', function () {
        var r = unionRescan(declared, ['a', 'b', 'c', 'd'], root);
        assert.equal(r.entries.c.settings, '/p/src/c/config/settings.json');
        assert.equal(r.entries.d.settings, '/p/src/d/config/settings.json');
    });

    it('warns for the declared-but-absent bundle and skips hidden files', function () {
        var r = unionRescan(declared, disk, root);
        assert.deepEqual(r.warns, ['x']);
    });

    it('is idempotent — a second pass adds nothing', function () {
        var first  = unionRescan(declared, disk, root);
        var second = unionRescan(first.bundles, disk, root);
        assert.deepEqual(second.bundles, first.bundles);
        assert.deepEqual(Object.keys(second.entries), []);
    });

    // SUBTRACT — the old logic on identical input, proving the assertions
    // above discriminate rather than passing vacuously.
    it('subtract: the old pipeline loses declarations and nests every later path', function () {
        var r = oldWipeAndRescan(declared, disk, root);
        assert.equal(r.bundles.indexOf('x'), -1,
            'the wipe dropped the declared-but-absent bundle');
        assert.equal(r.entries.a.settings, '/p/src/a/config/settings.json',
            'first disk bundle was the only correct one');
        assert.equal(r.entries.b.settings, '/p/src/a/b/config/settings.json',
            'second path nested under the first — the #B376 signature');
        assert.equal(r.entries.c.settings, '/p/src/a/b/c/config/settings.json');
        assert.equal(r.warns.length, 0, 'the old pipeline never surfaced the loss');
    });
});
