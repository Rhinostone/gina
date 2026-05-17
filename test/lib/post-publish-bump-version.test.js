/**
 * script/post_publish.js bumpVersion — source-structure pin.
 *
 * bumpVersion renames framework/v{old} -> framework/v{new} and rewrites
 * several sibling files (root package.json, framework/v{new}/package.json,
 * gna.js, local-sync-targets). The VERSION file inside the framework dir
 * is gitignored and moves with the renameSync; its content stays at
 * whatever the prior publish's updateVersionIfNeeded wrote, so without an
 * explicit rewrite VERSION drifts by 1 version every bumpVersion cycle.
 *
 * Pin locks the rewrite added so a local dev environment between alpha
 * cuts sees a VERSION file consistent with the framework dir name and the
 * root package.json. Without the pin, a future refactor could silently
 * drop the write and reintroduce the drift, which has no runtime impact
 * today (no readers) but does mislead anyone inspecting the file directly.
 */

'use strict';

var nodePath = require('path');
var fs = require('fs');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var SOURCE = nodePath.join(__dirname, '..', '..', 'script', 'post_publish.js');
var SRC = fs.readFileSync(SOURCE, 'utf8');


describe('01 - bumpVersion writes framework/v{new}/VERSION after rename', function () {

    it('builds the VERSION path via _(newVersionDir + ...) helper', function () {
        assert.ok(
            SRC.indexOf("newVersionDir + '/VERSION'") > -1,
            "expected `newVersionDir + '/VERSION'` literal in bumpVersion — VERSION rewrite missing"
        );
    });

    it('writes newVersion into the VERSION file via fs.writeFileSync', function () {
        assert.ok(
            /fs\.writeFileSync\s*\(\s*fwVersionPath\s*,\s*newVersion\s*\)/.test(SRC),
            'expected `fs.writeFileSync(fwVersionPath, newVersion)` — VERSION write missing'
        );
    });

    it('logs the VERSION update via [bumpVersion] console.info', function () {
        assert.ok(
            SRC.indexOf("[bumpVersion] Updated framework/v' + newVersion + '/VERSION:") > -1,
            'expected `[bumpVersion] Updated framework/v\' + newVersion + \'/VERSION:` log line — VERSION write missing visible logging'
        );
    });

    it('warns on VERSION write failure rather than throwing', function () {
        assert.ok(
            SRC.indexOf('[bumpVersion] Could not update framework VERSION:') > -1,
            "expected warn-don't-fail catch on VERSION write — block missing or throws instead"
        );
    });

});


describe('02 - bumpVersion VERSION write ordering vs sibling rewrites', function () {

    it('VERSION write appears AFTER the framework package.json write', function () {
        var pkgWriteIdx = SRC.indexOf("[bumpVersion] Updated framework/v' + newVersion + '/package.json version:");
        var verWriteIdx = SRC.indexOf("[bumpVersion] Updated framework/v' + newVersion + '/VERSION:");
        assert.ok(pkgWriteIdx > -1, 'framework package.json write log missing');
        assert.ok(verWriteIdx > -1, 'framework VERSION write log missing');
        assert.ok(
            verWriteIdx > pkgWriteIdx,
            'VERSION write should appear AFTER package.json write in bumpVersion'
        );
    });

    it('VERSION write appears BEFORE the gna.js update', function () {
        var verWriteIdx = SRC.indexOf("[bumpVersion] Updated framework/v' + newVersion + '/VERSION:");
        var gnaWriteIdx = SRC.indexOf('[bumpVersion] Updated gna.js framework paths:');
        assert.ok(verWriteIdx > -1, 'framework VERSION write log missing');
        assert.ok(gnaWriteIdx > -1, 'gna.js update log missing');
        assert.ok(
            verWriteIdx < gnaWriteIdx,
            'VERSION write should appear BEFORE gna.js update in bumpVersion'
        );
    });

});


describe('03 - bumpVersion local-sync warns on regex non-match', function () {

    it('warns when the local-sync regex did not match in a sidecar target', function () {
        assert.ok(
            SRC.indexOf('[bumpVersion] Local sync regex did not match in') > -1,
            "expected `[bumpVersion] Local sync regex did not match in` warn — silent-staleness gap fix missing"
        );
    });

    it("warn message names the failure mode ('file may be stale by more than one version')", function () {
        assert.ok(
            SRC.indexOf('file may be stale by more than one version') > -1,
            'expected the warn body to include the documented marker phrase — needed for operator triage'
        );
    });

    it('warn fires in the else branch of the `if (updated !== src)` local-sync write check', function () {
        var infoIdx = SRC.indexOf('[bumpVersion] Local sync: ');
        var warnIdx = SRC.indexOf('[bumpVersion] Local sync regex did not match in');
        assert.ok(infoIdx > -1, 'success-path info log missing');
        assert.ok(warnIdx > -1, 'non-match warn log missing');
        assert.ok(
            warnIdx > infoIdx,
            'warn (else branch) should appear AFTER the info log (if branch) in source order'
        );
        // The window between the info log and the warn log should hold the
        // closing `}` of the if-branch + the `else {` opener — keeps the warn
        // wired to the same conditional rather than orphaned elsewhere.
        var between = SRC.substring(infoIdx, warnIdx);
        assert.ok(
            /\}\s*else\s*\{/.test(between),
            'expected `} else {` between the info log and the warn log — warn should be the else branch of the same conditional'
        );
    });

});
