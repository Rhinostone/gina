/**
 * script/sync_docs_deps.js — behavioural tests.
 *
 * Covers the pure decision helpers `readLockedGina` and `resolveDocsDepState`
 * that make `syncDocs`' lockfile-regen-failure path FAIL CLOSED: on a failed
 * regen the docs `devDependencies.gina` is reverted to match the version still
 * pinned in the unregenerated `package-lock.json`, so the committed
 * package.json / package-lock.json pair stays internally consistent and the
 * docs content still deploys — and when the locked version cannot be read, the
 * develop→main merge is skipped rather than ship a mismatch.
 *
 * Negative-invariant pattern: on the failure path the returned devDep must NOT
 * equal the new version (that is the mismatch the fix exists to prevent), and
 * the unreadable-lockfile case must report mergeToMain=false.
 */

'use strict';

var nodePath = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var SCRIPT = nodePath.join(__dirname, '..', '..', 'script', 'sync_docs_deps.js');
var MOD = require(SCRIPT);


// ---------------------------------------------------------------------------
// 01 — module shape
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('exports readLockedGina and resolveDocsDepState', function () {
        assert.equal(typeof MOD.readLockedGina, 'function');
        assert.equal(typeof MOD.resolveDocsDepState, 'function');
    });
});


// ---------------------------------------------------------------------------
// 02 — readLockedGina: lockfileVersion 3 (path-keyed packages map)
// ---------------------------------------------------------------------------

describe('02 - readLockedGina: lockfileVersion 3', function () {

    it('reads the gina version from packages["node_modules/gina"]', function () {
        var lf = JSON.stringify({
            lockfileVersion: 3,
            packages: {
                '': { name: 'docs', version: '1.0.0' },
                'node_modules/gina': { version: '0.3.15', resolved: 'https://registry.npmjs.org/gina/-/gina-0.3.15.tgz' }
            }
        });
        assert.equal(MOD.readLockedGina(lf), '0.3.15');
    });
});


// ---------------------------------------------------------------------------
// 03 — readLockedGina: lockfileVersion 1 (flat dependencies map)
// ---------------------------------------------------------------------------

describe('03 - readLockedGina: lockfileVersion 1', function () {

    it('reads the gina version from dependencies.gina', function () {
        var lf = JSON.stringify({
            lockfileVersion: 1,
            dependencies: {
                gina: { version: '0.2.9', resolved: 'https://registry.npmjs.org/gina/-/gina-0.2.9.tgz' }
            }
        });
        assert.equal(MOD.readLockedGina(lf), '0.2.9');
    });
});


// ---------------------------------------------------------------------------
// 04 — readLockedGina: lockfileVersion 2 (both maps — packages preferred)
// ---------------------------------------------------------------------------

describe('04 - readLockedGina: lockfileVersion 2 prefers packages map', function () {

    it('prefers packages["node_modules/gina"] over dependencies.gina', function () {
        var lf = JSON.stringify({
            lockfileVersion: 2,
            packages: {
                '': { name: 'docs', version: '1.0.0' },
                'node_modules/gina': { version: '0.3.15' }
            },
            dependencies: {
                gina: { version: '0.0.0-stale' }
            }
        });
        assert.equal(MOD.readLockedGina(lf), '0.3.15');
    });
});


// ---------------------------------------------------------------------------
// 05 — readLockedGina: absent / empty / malformed / no-gina → null
// ---------------------------------------------------------------------------

describe('05 - readLockedGina: unreadable inputs return null', function () {

    it('returns null for null / empty string', function () {
        assert.equal(MOD.readLockedGina(null), null);
        assert.equal(MOD.readLockedGina(''), null);
    });

    it('returns null for malformed JSON', function () {
        assert.equal(MOD.readLockedGina('{ not valid json'), null);
    });

    it('returns null when the lockfile carries no gina entry', function () {
        var lf = JSON.stringify({
            lockfileVersion: 3,
            packages: { '': { name: 'docs', version: '1.0.0' } }
        });
        assert.equal(MOD.readLockedGina(lf), null);
    });

    it('returns null when the gina entry has no version key', function () {
        var lf = JSON.stringify({
            lockfileVersion: 3,
            packages: { 'node_modules/gina': { resolved: 'https://example/gina.tgz' } }
        });
        assert.equal(MOD.readLockedGina(lf), null);
    });

    it('falls back to dependencies.gina when packages entry lacks a version', function () {
        var lf = JSON.stringify({
            lockfileVersion: 2,
            packages: { 'node_modules/gina': { resolved: 'https://example/gina.tgz' } },
            dependencies: { gina: { version: '0.3.14' } }
        });
        assert.equal(MOD.readLockedGina(lf), '0.3.14');
    });
});


// ---------------------------------------------------------------------------
// 06 — resolveDocsDepState: regen SUCCESS → bump to new, merge safe
// ---------------------------------------------------------------------------

describe('06 - resolveDocsDepState: regen success', function () {

    it('returns devDep=^new, mergeToMain=true, reason=lockfile-fresh', function () {
        var state = MOD.resolveDocsDepState({
            lockResult: { ok: true, attempts: 1, lastErr: null },
            newVersion: '0.4.0'
        });
        assert.equal(state.devDep, '^0.4.0');
        assert.equal(state.mergeToMain, true);
        assert.equal(state.reason, 'lockfile-fresh');
    });
});


// ---------------------------------------------------------------------------
// 07 — resolveDocsDepState: regen FAILURE + readable lockfile → revert to old
//
// THE CORE CONSISTENCY INVARIANT: the returned devDep MATCHES the version
// still pinned in the (unregenerated) lockfile, so the committed pair is
// internally consistent — NOT the new version, which would be the mismatch.
// ---------------------------------------------------------------------------

describe('07 - resolveDocsDepState: regen failure, readable lockfile (revert)', function () {

    var oldLockfile = JSON.stringify({
        lockfileVersion: 3,
        packages: { 'node_modules/gina': { version: '0.3.15' } }
    });

    it('reverts devDep to ^<locked>, keeps mergeToMain=true', function () {
        var state = MOD.resolveDocsDepState({
            lockResult: { ok: false, attempts: 4, lastErr: new Error('ETARGET No matching version found for gina@^0.4.0') },
            lockfileContent: oldLockfile,
            newVersion: '0.4.0'
        });
        assert.equal(state.devDep, '^0.3.15');
        assert.equal(state.mergeToMain, true);
        assert.equal(state.reason, 'registry-lag-reverted');
    });

    it('negative invariant: the failure-path devDep is NOT the new version', function () {
        var state = MOD.resolveDocsDepState({
            lockResult: { ok: false, attempts: 4, lastErr: new Error('ETARGET') },
            lockfileContent: oldLockfile,
            newVersion: '0.4.0'
        });
        assert.notEqual(state.devDep, '^0.4.0');
    });
});


// ---------------------------------------------------------------------------
// 08 — resolveDocsDepState: regen FAILURE + unreadable lockfile → fail closed
//
// THE FAIL-CLOSED INVARIANT: when no consistent spec can be guaranteed, the
// merge is skipped (mergeToMain=false) so no mismatch reaches docs main.
// ---------------------------------------------------------------------------

describe('08 - resolveDocsDepState: regen failure, unreadable lockfile (fail closed)', function () {

    it('returns devDep=null, mergeToMain=false, reason=manual-recovery', function () {
        var state = MOD.resolveDocsDepState({
            lockResult: { ok: false, attempts: 4, lastErr: new Error('ETARGET') },
            lockfileContent: null,
            newVersion: '0.4.0'
        });
        assert.equal(state.devDep, null);
        assert.equal(state.mergeToMain, false);
        assert.equal(state.reason, 'manual-recovery');
    });

    it('also fails closed when the lockfile is present but carries no gina entry', function () {
        var noGina = JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'docs' } } });
        var state = MOD.resolveDocsDepState({
            lockResult: { ok: false, attempts: 4, lastErr: new Error('ETARGET') },
            lockfileContent: noGina,
            newVersion: '0.4.0'
        });
        assert.equal(state.devDep, null);
        assert.equal(state.mergeToMain, false);
        assert.equal(state.reason, 'manual-recovery');
    });
});


// ---------------------------------------------------------------------------
// 09 — resolveDocsDepState: prerelease version strings round-trip with ^
// ---------------------------------------------------------------------------

describe('09 - resolveDocsDepState: prerelease version handling', function () {

    it('prefixes a prerelease locked version with ^ unchanged', function () {
        var lf = JSON.stringify({
            lockfileVersion: 3,
            packages: { 'node_modules/gina': { version: '0.4.1-alpha.2' } }
        });
        var state = MOD.resolveDocsDepState({
            lockResult: { ok: false, attempts: 4, lastErr: new Error('ETARGET') },
            lockfileContent: lf,
            newVersion: '0.5.0'
        });
        assert.equal(state.devDep, '^0.4.1-alpha.2');
        assert.equal(state.mergeToMain, true);
    });
});
