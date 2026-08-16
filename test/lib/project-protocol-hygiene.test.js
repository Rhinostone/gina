/**
 * lib/cmd/helper.js loadAssets()/setPorts() + lib/cmd/project/add.js — the
 * project protocols/schemes lists are DERIVED bookkeeping constrained to the
 * framework's supported sets (#B378, #B379, #B380).
 *
 * The contract these pins lock: `~/main.json`'s per-version `protocols`/
 * `schemes` (surfaced as `protocolsAvailable`/`schemesAvailable`) are the
 * authority; a project's own lists are tooling-maintained bookkeeping that must
 * stay a subset of it. Three sites violated that:
 *
 * #B379 — the bundle-enrichment loop runs over EVERY registered project but
 * resolved each one's bundles against the CURRENT project's path, so a
 * same-named bundle in another project was read out of the wrong tree — its
 * `exists` flag, `configPaths`, defaults, and (via the adoption below) whatever
 * its namesake declared all leaked into the other project's registry entry.
 * Fixed: each project's bundles resolve against that project's own path.
 *
 * #B378 — a bundle's declared `server.protocol`/`server.scheme` was pushed
 * into the project's list unconditionally (the entry's list deliberately
 * aliases the project's own array — that is how the port matrix learns what
 * its bundles use — and the list persists to ~/.gina/projects.json, from where
 * `image:build` bakes it into a container's environment). Fixed: the push and
 * the entry-default assignment run only for values the framework supports; an
 * unsupported value is warned about by name, once per command, and adopted
 * nowhere. The import-time settings heal that rewrites an invalid declaration
 * to the project default now reports each change by name instead of a debug
 * line — a user file is never rewritten silently.
 *
 * #B380 — setPorts' merge loops read the TARGET array by the SOURCE's index
 * (`for (let p in cmd.protocols)` reading the project list at `[p]`; the env
 * loop directly above always had the correct shape), so an overshoot read
 * undefined. Fixed: read the source by its own index, and gate the merge on
 * the framework sets — the contextual list also grows from ports.json keys,
 * which can retain protocols a framework update removed.
 *
 * Source-inspection pins + pure-logic replicas with SUBTRACT arms running the
 * old logic on identical input, proving each assertion discriminates. Needle
 * counts were measured in BOTH corpora before writing (a bare
 * `allProjectProtocols[p]` needle would have been wrong: a legitimate
 * own-index read of that array exists further down, so the negative pins use
 * the var-qualified forms). Red-first validated against the pre-fix source via
 * `git show` — recorded split in the arc's ledger entry.
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


// ---------------------------------------------------------------------------
// 01 — #B379: per-project path resolution in the enrichment loop
// ---------------------------------------------------------------------------

describe('01 - #B379 per-project bundle resolution (helper.js)', function () {

    it('no bundle path is built from the current-project location', function () {
        assert.equal(helperRaw.indexOf("cmd.projectLocation + '/'+ cmd.bundlesByProject"), -1);
    });

    it('each project resolves its bundles against its own registered path', function () {
        var count = helperRaw.split('_ownProjectPath').length - 1;
        assert.ok(count >= 3, 'expected the per-project base declared and used, saw ' + count);
    });
});


// ---------------------------------------------------------------------------
// 02 — #B378: adoption gated on the framework's supported sets
// ---------------------------------------------------------------------------

describe('02 - #B378 adoption gate (helper.js)', function () {

    it('a declared protocol extends the list only when the framework supports it', function () {
        assert.ok(helperRaw.indexOf('cmd.protocolsAvailable.indexOf(settings.server.protocol) > -1') > -1);
    });

    it('the scheme axis carries the identical gate', function () {
        assert.ok(helperRaw.indexOf('cmd.schemesAvailable.indexOf(settings.server.scheme) > -1') > -1);
    });

    it('an unsupported value is surfaced by name, never adopted', function () {
        assert.ok(helperRaw.indexOf('is not an allowed protocol') > -1);
        assert.ok(helperRaw.indexOf('is not an allowed scheme') > -1);
    });

    it('the warning is deduplicated per command via cmd state', function () {
        var count = helperRaw.split('warnedInvalidServerSettings').length - 1;
        assert.ok(count >= 4, 'expected the dedup key seeded, read and written on both axes, saw ' + count);
    });
});


// ---------------------------------------------------------------------------
// 03 — #B380: setPorts merge reads the source and honours the authority
// ---------------------------------------------------------------------------

describe('03 - #B380 setPorts merge (helper.js)', function () {

    it('the protocol merge reads the source list by its own index', function () {
        assert.ok(helperRaw.indexOf('let newProtocol = cmd.protocols[p]') > -1);
        assert.equal(helperRaw.indexOf('newProtocol = allProjectProtocols[p]'), -1,
            'the target-indexed read is the defect');
    });

    it('the scheme merge reads the source list by its own index', function () {
        assert.ok(helperRaw.indexOf('let newScheme = cmd.schemes[p]') > -1);
        assert.equal(helperRaw.indexOf('newScheme = allProjectSchemes[p]'), -1);
    });

    it('the merge admits only framework-supported values', function () {
        assert.ok(helperRaw.indexOf('cmd.protocolsAvailable.indexOf(newProtocol) > -1') > -1);
        assert.ok(helperRaw.indexOf('cmd.schemesAvailable.indexOf(newScheme) > -1') > -1);
    });
});


// ---------------------------------------------------------------------------
// 04 — #B378: the import-time settings heal reports what it changed
// ---------------------------------------------------------------------------

describe('04 - settings heal reports by name (add.js)', function () {

    it('each healed field is recorded before being overwritten', function () {
        var count = addRaw.split('_settingsChanges').length - 1;
        assert.ok(count >= 3, 'expected the change collector declared and pushed on both axes, saw ' + count);
    });

    it('the silent debug line is gone', function () {
        assert.equal(addRaw.indexOf("console.debug('updated [ '+ bundleName +' ] settings')"), -1);
    });

    it('the heal surfaces as a warning naming the changes', function () {
        assert.ok(addRaw.indexOf("console.warn('Updated [ '+ bundleName +' ] settings: '") > -1);
    });
});


// ---------------------------------------------------------------------------
// 05 — pure-logic replica of the adoption decision (with a subtract arm)
// ---------------------------------------------------------------------------

// Faithful replica of the FIXED decision for one declared value.
function adoptDecision(value, availableList, projectList) {
    var pushed = false, madeDefault = false, warned = false;
    if (availableList.indexOf(value) > -1) {
        if (projectList.indexOf(value) < 0) { projectList.push(value); pushed = true; }
        madeDefault = true;
    } else {
        warned = true;
    }
    return { pushed: pushed, madeDefault: madeDefault, warned: warned, list: projectList };
}

// The OLD decision on the same inputs: unconditional adopt + default.
function oldAdoptDecision(value, availableList, projectList) {
    var pushed = false;
    if (projectList.indexOf(value) < 0) { projectList.push(value); pushed = true; }
    return { pushed: pushed, madeDefault: true, warned: false, list: projectList };
}

describe('05 - adoption decision replica', function () {

    var AVAILABLE = ['http/1.1', 'http/2.0'];

    it('a supported value missing from the list is adopted and becomes the default', function () {
        var r = adoptDecision('http/2.0', AVAILABLE, ['http/1.1']);
        assert.deepEqual(r, { pushed: true, madeDefault: true, warned: false, list: ['http/1.1', 'http/2.0'] });
    });

    it('a supported value already listed only sets the default', function () {
        var r = adoptDecision('http/1.1', AVAILABLE, ['http/1.1']);
        assert.equal(r.pushed, false);
        assert.equal(r.madeDefault, true);
        assert.equal(r.warned, false);
    });

    it('an unsupported value is warned and adopted nowhere', function () {
        var r = adoptDecision('bogus', AVAILABLE, ['http/1.1']);
        assert.deepEqual(r, { pushed: false, madeDefault: false, warned: true, list: ['http/1.1'] });
    });

    it('subtract: the old decision adopts and defaults the unsupported value', function () {
        var r = oldAdoptDecision('bogus', AVAILABLE, ['http/1.1']);
        assert.equal(r.pushed, true);
        assert.equal(r.madeDefault, true);
        assert.deepEqual(r.list, ['http/1.1', 'bogus'],
            'the pollution the gate exists to stop — proves the replica discriminates');
    });
});


// ---------------------------------------------------------------------------
// 06 — pure-logic replica of the setPorts merge (with a subtract arm)
// ---------------------------------------------------------------------------

// Faithful replica of the FIXED merge: source read by its own index, gated.
function mergeLists(contextual, projectList, availableList) {
    for (var p = 0; p < contextual.length; ++p) {
        var v = contextual[p];
        if (availableList.indexOf(v) > -1 && projectList.indexOf(v) < 0) {
            projectList.push(v);
        }
    }
    return projectList;
}

// The OLD merge: target read by the source's index, ungated.
function oldMergeLists(contextual, projectList) {
    for (var p = 0; p < contextual.length; ++p) {
        var v = projectList[p];             // the defect: wrong array
        if (projectList.indexOf(v) < 0) {
            projectList.push(v);
        }
    }
    return projectList;
}

describe('06 - setPorts merge replica', function () {

    var AVAILABLE = ['http/1.1', 'http/2.0'];

    it('merges supported contextual values the project list lacks', function () {
        var r = mergeLists(['http/1.1', 'http/2.0'], ['http/1.1'], AVAILABLE);
        assert.deepEqual(r, ['http/1.1', 'http/2.0']);
    });

    it('an upgrade-removed ports.json key never re-enters the list', function () {
        var r = mergeLists(['http/1.1', 'spdy'], ['http/1.1'], AVAILABLE);
        assert.deepEqual(r, ['http/1.1']);
    });

    it('subtract: the old merge pushes undefined on overshoot', function () {
        // contextual outgrew the project list — the old read overshoots the target
        var r = oldMergeLists(['http/1.1', 'http/2.0'], ['http/1.1']);
        assert.ok(r.indexOf(undefined) > -1,
            'the wrong-array read yields undefined past the target length — proves the replica discriminates');
    });
});
