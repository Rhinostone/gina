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


describe('04 - bumpVersion local-sync regex consumes optional -alpha.N suffix (#R3)', function () {

    it('versionPattern matches the optional (?:-alpha\\.\\d+)? whole-token suffix group', function () {
        assert.ok(
            SRC.indexOf("(?:-alpha\\\\.\\\\d+)?") > -1,
            "expected `(?:-alpha\\.\\d+)?` whole-token suffix group in versionPattern — #R3 fix missing, bare-semver currentVersion (e.g. 0.3.15) would still match the prefix of v0.3.15-alpha.6 and produce concatenated v0.3.16-alpha.X-alpha.6 corruption"
        );
    });

    it('versionPattern uses the tightened (?![\\w.-]) negative-lookahead', function () {
        assert.ok(
            SRC.indexOf("(?![\\\\w.-])") > -1,
            "expected `(?![\\w.-])` tightened lookahead in versionPattern — old `(?![\\d.])` permitted `-` as the next char, which is what allowed the prefix match against alpha-suffixed versions"
        );
    });

    it('combines optional suffix + tightened lookahead inline in the same regex pattern string', function () {
        assert.ok(
            SRC.indexOf("'(?:-alpha\\\\.\\\\d+)?(?![\\\\w.-])'") > -1,
            "expected `'(?:-alpha\\.\\d+)?(?![\\w.-])'` inline — both fragments must appear together as a single trailing pattern, not split across edits"
        );
    });

    it('does NOT carry the old (?![\\d.]) lookahead anywhere near versionPattern', function () {
        var idx = SRC.indexOf('versionPattern');
        assert.ok(idx > -1, 'versionPattern declaration not found');
        var window = SRC.substring(idx, idx + 400);
        assert.equal(
            /\(\?\!\[\\\\d\.\]\)/.test(window),
            false,
            'old `(?![\\d.])` lookahead still appears within 400 chars of versionPattern — #R3 regression risk, bare-prefix match would corrupt alpha-suffixed versions again'
        );
    });

});


describe('05 - bumpVersion local-sync post-replace concatenated-suffix safety guard (#R3)', function () {

    it('asserts a regex check against the concatenated alpha-suffix shape', function () {
        assert.ok(
            SRC.indexOf('/v\\d+\\.\\d+\\.\\d+-alpha\\.\\d+-alpha\\.\\d+/') > -1,
            "expected `/v\\d+\\.\\d+\\.\\d+-alpha\\.\\d+-alpha\\.\\d+/` safety check regex — #R3 defense-in-depth missing, a regex regression would persist corrupted content silently"
        );
    });

    it('emits a [bumpVersion] warn naming the concatenated-suffix failure mode', function () {
        assert.ok(
            SRC.indexOf('[bumpVersion] Local sync produced concatenated alpha suffix in ') > -1,
            "expected concatenated-suffix warn message — safety guard missing visible logging"
        );
    });

    it('safety guard appears AFTER src.replace and BEFORE the if (updated !== src) write conditional', function () {
        var replaceIdx = SRC.indexOf('src.replace(versionPattern, ');
        var guardIdx   = SRC.indexOf('[bumpVersion] Local sync produced concatenated alpha suffix in ');
        var writeIdx   = SRC.indexOf('[bumpVersion] Local sync: ');
        assert.ok(replaceIdx > -1, 'src.replace call missing');
        assert.ok(guardIdx   > -1, 'safety guard warn missing');
        assert.ok(writeIdx   > -1, 'write info log missing');
        assert.ok(
            guardIdx > replaceIdx,
            'safety guard should appear AFTER src.replace in source order'
        );
        assert.ok(
            guardIdx < writeIdx,
            'safety guard should appear BEFORE the write info log in source order'
        );
    });

    it('safety guard fail-closes via continue between warn and the if-write conditional', function () {
        var guardIdx = SRC.indexOf('[bumpVersion] Local sync produced concatenated alpha suffix in ');
        var writeIdx = SRC.indexOf('[bumpVersion] Local sync: ');
        assert.ok(guardIdx > -1 && writeIdx > -1);
        var between = SRC.substring(guardIdx, writeIdx);
        assert.ok(
            /continue\s*;/.test(between),
            'expected `continue;` between the safety warn and the write — fail-closed shape missing, guard would warn-but-still-write'
        );
    });

});
