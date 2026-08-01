'use strict';
/**
 * utils/helper.js — importEnvVars(): the GINA_* / VENDOR_* / USER_* env import
 * extracted from filterArgs() so bin/cli can run an early keep-mode
 * visibility pass BEFORE its home/settings/host resolution block. Move
 * semantics (delete from process.env) stay in the filterArgs() sweep via the
 * same function; the keep-mode pass leaves process.env intact so the later
 * sweep still runs and post-sweep precedence (shell values winning over
 * in-bootstrap setEnvVar writes) is byte-identical to the pre-extraction
 * behaviour. Without the early pass, an exported GINA_HOMEDIR /
 * GINA_BIND_HOST / GINA_MQ_PORT was invisible to the resolution block and
 * took effect one command late (via the settings regeneration) or never.
 *
 * Sections:
 *   01 — keep-mode behavioral (the bin/cli early visibility pass)
 *   02 — move-mode behavioral (the filterArgs sweep semantics)
 *   03 — source pins (extraction, self-init, the init-target fix)
 *   04 — bin/cli ordering (early pass precedes the resolution block)
 */

var { describe, it, beforeEach, afterEach } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

// Installs the implicit helper globals (getEnvVar, setEnvVar, importEnvVars…).
require(path.join(__dirname, '..', '..', 'utils', 'helper'));

var HELPER_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'utils', 'helper.js'), 'utf8');
var CLI_SRC    = fs.readFileSync(path.join(__dirname, '..', '..', 'bin', 'cli'), 'utf8');

function cleanKeys() {
    ['GINA_IEV_T1', 'VENDOR_IEV_T2', 'USER_IEV_T3', 'PLAIN_IEV_T4'].forEach(function (k) {
        delete process.env[k];
        if (process.gina) { delete process.gina[k]; }
    });
}

// ---------------------------------------------------------------------------
// 01 — keep-mode behavioral
// ---------------------------------------------------------------------------

describe('01 - importEnvVars keep-mode (the bin/cli early visibility pass)', function () {

    beforeEach(function () {
        cleanKeys();
        process.env.GINA_IEV_T1   = 'g-val';
        process.env.VENDOR_IEV_T2 = 'v-val';
        process.env.USER_IEV_T3   = 'u-val';
        process.env.PLAIN_IEV_T4  = 'p-val';
    });

    afterEach(cleanKeys);

    it('is installed as a helper global', function () {
        assert.equal(typeof global.importEnvVars, 'function');
    });

    it('imports all three prefixes into the framework environment and leaves process.env intact', function () {
        global.importEnvVars(true);
        assert.equal(process.gina.GINA_IEV_T1, 'g-val');
        assert.equal(process.gina.VENDOR_IEV_T2, 'v-val');
        assert.equal(process.gina.USER_IEV_T3, 'u-val');
        // keep-mode: the later sweep must still find them in process.env
        assert.equal(process.env.GINA_IEV_T1, 'g-val');
        assert.equal(process.env.VENDOR_IEV_T2, 'v-val');
        assert.equal(process.env.USER_IEV_T3, 'u-val');
    });

    it('control: an unprefixed key is neither imported nor touched', function () {
        global.importEnvVars(true);
        assert.equal(process.env.PLAIN_IEV_T4, 'p-val');
        assert.ok(!(process.gina && Object.prototype.hasOwnProperty.call(process.gina, 'PLAIN_IEV_T4')));
    });
});

// ---------------------------------------------------------------------------
// 02 — move-mode behavioral (the sweep)
// ---------------------------------------------------------------------------

describe('02 - importEnvVars move-mode (the filterArgs sweep semantics)', function () {

    beforeEach(function () {
        cleanKeys();
        process.env.GINA_IEV_T1  = 'g-val';
        process.env.PLAIN_IEV_T4 = 'p-val';
    });

    afterEach(cleanKeys);

    it('moves prefixed keys into the framework environment and deletes them from process.env', function () {
        global.importEnvVars();
        assert.equal(process.gina.GINA_IEV_T1, 'g-val');
        assert.ok(!Object.prototype.hasOwnProperty.call(process.env, 'GINA_IEV_T1'));
        // the unprefixed control survives the sweep
        assert.equal(process.env.PLAIN_IEV_T4, 'p-val');
    });

    it('is idempotent — a second call re-imports nothing', function () {
        global.importEnvVars();
        process.gina.GINA_IEV_T1 = 'mutated-after-sweep';
        global.importEnvVars();
        assert.equal(process.gina.GINA_IEV_T1, 'mutated-after-sweep');
    });
});

// ---------------------------------------------------------------------------
// 03 — source pins
// ---------------------------------------------------------------------------

describe('03 - source pins: extraction, self-init, init-target fix', function () {

    it('the prefix test lives in exactly one place — the inline filterArgs loop is gone', function () {
        var m = HELPER_SRC.match(/substring\(0, 7\) === 'VENDOR_'/g);
        assert.ok(m, 'the VENDOR_ prefix check must exist');
        assert.equal(m.length, 1, 'the prefix check must appear exactly once (inside importEnvVars)');
    });

    it('filterArgs delegates its env sweep to importEnvVars()', function () {
        var fa    = HELPER_SRC.indexOf('filterArgs = function');
        var iev   = HELPER_SRC.indexOf('importEnvVars = function');
        assert.ok(fa > -1 && iev > -1, 'both declarations must exist');
        var faSlice = HELPER_SRC.substring(fa, iev);
        assert.match(faSlice, /importEnvVars\(\);/, 'filterArgs must call the extracted sweep (move mode)');
    });

    it('importEnvVars self-inits process.gina — safe before any setEnvVar', function () {
        var iev = HELPER_SRC.indexOf('importEnvVars = function');
        var slice = HELPER_SRC.substring(iev, iev + 400);
        assert.match(slice, /typeof\(process\['gina'\]\) == 'undefined'/);
    });

    it('the keep flag gates the delete — move mode deletes, keep mode does not', function () {
        var iev = HELPER_SRC.indexOf('importEnvVars = function');
        var slice = HELPER_SRC.substring(iev, iev + 700);
        assert.match(slice, /if \(!keep\) \{\s*delete process\.env\[e\]/);
    });

    it('filterArgs argv-promotion init targets the framework environment — the junk-string env export is gone', function () {
        // Pre-fix, the guard initialised process.ENV["gina"], assigning an
        // object that coerces to "[object Object]" and rode into every
        // child process environment.
        assert.doesNotMatch(HELPER_SRC, /process\.env\['gina'\]\s*=/);
    });
});

// ---------------------------------------------------------------------------
// 04 — bin/cli ordering
// ---------------------------------------------------------------------------

describe('04 - bin/cli ordering: the early pass precedes the resolution block', function () {

    it('bin/cli runs importEnvVars(true) before home resolution, the host/bind reads, and the sweep', function () {
        var early    = CLI_SRC.indexOf('importEnvVars(true)');
        var homeRes  = CLI_SRC.indexOf('home = getUserHome()');
        var hostRead = CLI_SRC.indexOf("getEnvVar('GINA_HOST_V4') || settings['host_v4']");
        var bindRead = CLI_SRC.indexOf("getEnvVar('GINA_BIND_HOST') || settings['bind_host']");
        // Code-unique call form (trailing semicolon): a prose mention of the
        // sweep in a comment must not steal this anchor.
        var sweep    = CLI_SRC.indexOf('filterArgs();');
        assert.ok(early > -1, 'the early visibility pass must exist in bin/cli');
        assert.ok(homeRes > -1 && hostRead > -1 && bindRead > -1 && sweep > -1, 'anchors must exist');
        assert.ok(early < homeRes, 'early pass must precede home resolution (idx ' + early + ' vs ' + homeRes + ')');
        assert.ok(early < hostRead, 'early pass must precede the host_v4 read');
        assert.ok(early < bindRead, 'early pass must precede the bind_host read');
        assert.ok(early < sweep, 'early pass must precede the filterArgs sweep');
    });

    it('the early pass is keep-mode — the sweep at the end of bootstrap keeps move semantics', function () {
        // importEnvVars appears in bin/cli exactly once, with keep=true; the
        // move-mode call stays inside filterArgs (utils/helper.js).
        var m = CLI_SRC.match(/importEnvVars\(/g);
        assert.equal(m.length, 1, 'exactly one direct call in bin/cli');
        assert.match(CLI_SRC, /importEnvVars\(true\)/);
    });
});
