/**
 * script/prepare_version.js — framework/v{new}/package.json version rewrite pin.
 *
 * The stable-cut path (prepare_version.js, the `prepare` lifecycle script) renames
 * framework/v{old} -> framework/v{new} and rewrites several siblings (root
 * package.json main + exports.require, gna.js paths, local-sync targets) — but
 * historically NOT the framework/v{new}/package.json `version` field. The file is
 * gitignored and moved byte-for-byte by the renameSync, so its version stayed at
 * the prior (pre-cut) value and the published tarball's sub-manifest shipped a
 * stale version (measured: gina@0.4.7's framework/v0.4.7/package.json read
 * 0.4.7-alpha.2). post_publish.js bumpVersion (the alpha->alpha path) already does
 * this rewrite (post-publish-bump-version.test.js §02 pins it); prepare_version.js
 * lacked it. This pins the ported rewrite so a future refactor cannot silently drop
 * it and reintroduce the drift.
 *
 * Source-inspection pins (prepare_version.js runs the full publish bootstrap, too
 * heavy to invoke) + a pure-logic replica of the rewrite decision.
 */

'use strict';

var nodePath = require('path');
var fs = require('fs');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var SOURCE = nodePath.join(__dirname, '..', '..', 'script', 'prepare_version.js');
var SRC = fs.readFileSync(SOURCE, 'utf8');


// ---------------------------------------------------------------------------
// 01 — the rewrite exists
// ---------------------------------------------------------------------------

describe('01 - prepare_version rewrites framework/v{new}/package.json version', function () {

    it('builds the framework package.json path via _(frameworkPath + ...)', function () {
        assert.ok(
            SRC.indexOf("_(frameworkPath + '/package.json', true)") > -1,
            "expected `_(frameworkPath + '/package.json', true)` — framework package.json rewrite missing"
        );
    });

    it('only rewrites when the version actually differs (idempotent)', function () {
        assert.ok(
            SRC.indexOf('fwPackObj.version !== targetedVersion') > -1,
            'expected `fwPackObj.version !== targetedVersion` guard'
        );
    });

    it('sets the version to targetedVersion', function () {
        assert.ok(
            SRC.indexOf('fwPackObj.version = targetedVersion;') > -1,
            'expected `fwPackObj.version = targetedVersion;` assignment'
        );
    });

    it('writes the framework package.json via fs.writeFileSync (JSON, 2-space)', function () {
        assert.ok(
            SRC.indexOf('fs.writeFileSync(fwPackPath, JSON.stringify(fwPackObj, null, 2)') > -1,
            'expected `fs.writeFileSync(fwPackPath, JSON.stringify(fwPackObj, null, 2)...)` write'
        );
    });

    it('logs the update via [prepare] console.info', function () {
        assert.ok(
            SRC.indexOf("[prepare] Updated framework/v' + targetedVersion + '/package.json version:") > -1,
            'expected `[prepare] Updated framework/v\' + targetedVersion + \'/package.json version:` log line'
        );
    });

    it('warns on failure rather than throwing (a cut never aborts on it)', function () {
        assert.ok(
            SRC.indexOf('[prepare] Could not update framework package.json:') > -1,
            "expected warn-don't-fail catch — block missing or throws instead"
        );
    });
});


// ---------------------------------------------------------------------------
// 02 — placement: inside the rename block, after renameSync, before gna.js
// ---------------------------------------------------------------------------

describe('02 - rewrite placement', function () {

    it('appears AFTER the framework-dir renameSync', function () {
        var renameIdx = SRC.indexOf('frameworkPathObj.renameSync(destination)');
        var fwPkgIdx  = SRC.indexOf("_(frameworkPath + '/package.json', true)");
        assert.ok(renameIdx > -1, 'renameSync not found');
        assert.ok(fwPkgIdx > renameIdx, 'framework package.json rewrite must come AFTER the renameSync (uses the renamed dir)');
    });

    it('appears AFTER the root package.json write and BEFORE the gna.js update', function () {
        var rootPkgIdx = SRC.indexOf('lib.generator.createFileFromDataSync(JSON.stringify(package, null, 2), pack)');
        var fwPkgIdx   = SRC.indexOf("[prepare] Updated framework/v' + targetedVersion + '/package.json version:");
        var gnaIdx     = SRC.indexOf('[prepare] Updated gna.js framework paths:');
        assert.ok(rootPkgIdx > -1 && fwPkgIdx > -1 && gnaIdx > -1, 'one of the three anchor sites is missing');
        assert.ok(fwPkgIdx > rootPkgIdx, 'framework package.json rewrite should follow the root package.json write');
        assert.ok(fwPkgIdx < gnaIdx, 'framework package.json rewrite should precede the gna.js update');
    });
});


// ---------------------------------------------------------------------------
// 03 — pure-logic replica (the rewrite decision)
// ---------------------------------------------------------------------------

describe('03 - pure-logic replica', function () {

    // Mirror of the in-block decision: rewrite version only when it differs.
    function rewriteFwVersion(fwPackObj, targetedVersion) {
        if (fwPackObj.version !== targetedVersion) {
            fwPackObj.version = targetedVersion;
            return true;
        }
        return false;
    }

    it('rewrites a drifted alpha version to the cut version', function () {
        var o = { name: 'gina', version: '0.4.7-alpha.2' };
        assert.equal(rewriteFwVersion(o, '0.4.7'), true);
        assert.equal(o.version, '0.4.7');
    });

    it('is a no-op when already in sync', function () {
        var o = { name: 'gina', version: '0.4.7' };
        assert.equal(rewriteFwVersion(o, '0.4.7'), false);
        assert.equal(o.version, '0.4.7');
    });

    it('changes only the version field (other keys preserved)', function () {
        var o = { name: 'gina', version: '0.4.7-alpha.2', main: './core/gna', dependencies: { psl: '^1.15.0' } };
        rewriteFwVersion(o, '0.4.7');
        assert.deepEqual(o, { name: 'gina', version: '0.4.7', main: './core/gna', dependencies: { psl: '^1.15.0' } });
    });
});
