/**
 * lib/cmd-status-format/src/main.js — shared CLI status primitives
 *
 * Behavioral tests (require-by-path, mirroring routing-introspect.test.js).
 * The module is pure — it requires only node builtins and reads no framework
 * globals — so it can be exercised directly, unlike the source-inspection
 * suites the four consuming handlers used to carry for their inline copies.
 */

'use strict';

var fs   = require('fs');
var os   = require('os');
var path = require('path');
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');

var FW  = require('../fw');
var fmt = require(path.join(FW, 'lib/cmd-status-format/src/main'));


// ---------------------------------------------------------------------------
// 01 — pad
// ---------------------------------------------------------------------------

describe('01 - pad', function () {

    it('right-pads with spaces until width is reached', function () {
        assert.equal(fmt.pad('api', 8), 'api     ');
    });

    it('returns the string unchanged when already at or beyond width', function () {
        assert.equal(fmt.pad('toolongname', 4), 'toolongname');
    });

    it('coerces null / undefined to the empty string', function () {
        assert.equal(fmt.pad(null, 3), '   ');
        assert.equal(fmt.pad(undefined, 2), '  ');
    });

    it('handles width 0', function () {
        assert.equal(fmt.pad('x', 0), 'x');
    });
});


// ---------------------------------------------------------------------------
// 02 — pickPreferredPort
// ---------------------------------------------------------------------------

describe('02 - pickPreferredPort', function () {

    it('returns null for null / empty / no-env records', function () {
        assert.equal(fmt.pickPreferredPort(null), null);
        assert.equal(fmt.pickPreferredPort({}), null);
        assert.equal(fmt.pickPreferredPort({ dev: null }), null);
        assert.equal(fmt.pickPreferredPort({ dev: {} }), null);
    });

    it('prefers the dev env over other envs', function () {
        var r = fmt.pickPreferredPort({
            dev:  { 'http/2.0': { https: 4208 } },
            prod: { 'http/2.0': { https: 4209 } }
        });
        assert.deepEqual(r, { env: 'dev', scheme: 'http/2.0', protocol: 'https', port: 4208 });
    });

    it('falls back to the first env key when no dev env', function () {
        var r = fmt.pickPreferredPort({ prod: { 'http/2.0': { https: 4209 } } });
        assert.deepEqual(r, { env: 'prod', scheme: 'http/2.0', protocol: 'https', port: 4209 });
    });

    it('prefers http/2.0 https over http/1.1', function () {
        var r = fmt.pickPreferredPort({
            dev: { 'http/1.1': { http: 4200, https: 4204 }, 'http/2.0': { https: 4208 } }
        });
        assert.deepEqual(r, { env: 'dev', scheme: 'http/2.0', protocol: 'https', port: 4208 });
    });

    it('falls back to http/1.1 https before http/1.1 http', function () {
        var r = fmt.pickPreferredPort({ dev: { 'http/1.1': { http: 4200, https: 4204 } } });
        assert.deepEqual(r, { env: 'dev', scheme: 'http/1.1', protocol: 'https', port: 4204 });
    });

    it('falls back to http/1.1 http last', function () {
        var r = fmt.pickPreferredPort({ dev: { 'http/1.1': { http: 4200 } } });
        assert.deepEqual(r, { env: 'dev', scheme: 'http/1.1', protocol: 'http', port: 4200 });
    });
});


// ---------------------------------------------------------------------------
// 03 — readPidfile
// ---------------------------------------------------------------------------

describe('03 - readPidfile', function () {

    var runDir;

    before(function () {
        runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-csf-'));
    });

    after(function () {
        try { fs.rmSync(runDir, { recursive: true, force: true }); } catch (e) {}
    });

    it('returns stopped when the pidfile is missing', function () {
        assert.deepEqual(fmt.readPidfile(runDir, 'absent', 'proj'), { running: false, pid: null });
    });

    it('reads <runDir>/<bundle>@<project>.pid and reports a live pid as running', function () {
        fs.writeFileSync(path.join(runDir, 'live@proj.pid'), String(process.pid));
        assert.deepEqual(fmt.readPidfile(runDir, 'live', 'proj'), { running: true, pid: process.pid });
    });

    it('reports a non-numeric pidfile as stopped', function () {
        fs.writeFileSync(path.join(runDir, 'garbage@proj.pid'), 'not-a-pid');
        assert.deepEqual(fmt.readPidfile(runDir, 'garbage', 'proj'), { running: false, pid: null });
    });

    it('rejects a non-positive pid', function () {
        fs.writeFileSync(path.join(runDir, 'zero@proj.pid'), '0');
        assert.deepEqual(fmt.readPidfile(runDir, 'zero', 'proj'), { running: false, pid: null });
    });

    it('reports a stale (dead) pid as stopped without deleting the file', function () {
        var pidPath = path.join(runDir, 'stale@proj.pid');
        fs.writeFileSync(pidPath, '2147483646'); // improbable pid → kill(0) throws → stopped
        assert.deepEqual(fmt.readPidfile(runDir, 'stale', 'proj'), { running: false, pid: null });
        assert.equal(fs.existsSync(pidPath), true, 'a stale pidfile must not be deleted');
    });
});
