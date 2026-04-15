/**
 * #B12 — Whisper no longer emits an error on unknown keys; post_install seeds
 * def_global_mode[shortVersion] from packObj.config.globalMode.
 *
 * Source-inspection tests: the runtime modules (helpers/context.js,
 * script/post_install.js) depend on injected globals and npm lifecycle state
 * that are not available in a bare node:test context. We verify the fix by
 * scanning the source for the expected shape.
 */

'use strict';

var fs     = require('fs');
var path   = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var FW_PATH      = require('../fw');
var CONTEXT_PATH = path.join(FW_PATH, 'helpers/context.js');
var POST_INSTALL_PATH = path.resolve(__dirname, '..', '..', 'script', 'post_install.js');

var contextSrc     = fs.readFileSync(CONTEXT_PATH, 'utf8');
var postInstallSrc = fs.readFileSync(POST_INSTALL_PATH, 'utf8');


describe('#B12 — whisper() silent on unknown keys', function () {

    it('no longer logs a [Whisper Error] console.error for unknown keys', function () {
        assert.equal(
            /console\.error\([^)]*Whisper Error/.test(contextSrc),
            false,
            'context.js still contains a "Whisper Error" console.error — fix #B12 regressed'
        );
    });

    it('no longer prints the "Skipping replacement to prevent infinite loop" message', function () {
        assert.equal(
            /Skipping replacement to prevent infinite loop/.test(contextSrc),
            false,
            'context.js still prints the infinite-loop warning text — fix #B12 regressed'
        );
    });

    it('third replace pass returns the original string unchanged when key is missing', function () {
        // Locate the third .replace block handling embedded ${key} tokens.
        var block = contextSrc.match(/\.replace\(\/\.\*\\\$\\\{\(\\w\+\)\\\}\.\*\/g,[\s\S]{0,800}?\}\)/);
        assert.ok(block, 'Third replace pass not found in whisper()');
        var blockSrc = block[0];

        // Must still guard undefined (infinite-loop guard preserved).
        assert.match(blockSrc, /dictionary\[key\] !== undefined/, 'undefined guard removed');

        // Must silently return s when undefined — no console.error.
        assert.equal(/console\.error/.test(blockSrc), false, 'third pass still logs console.error');
        assert.match(blockSrc, /return s;/, 'third pass must return the original string when key is missing');
    });

    it('has JSDoc documenting the silent-pass behaviour (#B12)', function () {
        var docBlock = contextSrc.match(/\/\*\*[\s\S]{0,2000}?\*\/\s*global\.whisper = function/);
        assert.ok(docBlock, 'whisper() is missing its JSDoc block');
        assert.match(docBlock[0], /#B12|silent|Unknown keys/i,
            'whisper() JSDoc must note the silent-on-unknown-key behaviour');
    });
});


describe('#B12 — post_install seeds def_global_mode', function () {

    it('loads packObj via require(pack) and reads packObj.config.globalMode', function () {
        assert.match(postInstallSrc, /require\(pack\)/,
            'post_install.js must load packObj via require(pack)');
        assert.match(postInstallSrc, /packObj\.config\.globalMode|_packObj\.config\.globalMode/,
            'post_install.js must read packObj.config.globalMode for the seed');
    });

    it('coerces string "true"/"false" overrides to booleans', function () {
        // npm config set gina:globalMode <value> rewrites config.globalMode as a string.
        assert.match(postInstallSrc, /\/\^true\$\/i\.test\(_?gmRaw?\)|\/\^true\$\/i\.test\(_gmRaw\)/,
            'post_install.js must coerce string overrides to booleans via /^true$/i');
    });

    it('writes def_global_mode[shortVersion] to root main.json when present', function () {
        // Look for the seed block's root-path write.
        assert.match(postInstallSrc, /def_global_mode\[self\.shortVersion\]\s*=/,
            'post_install.js must write def_global_mode[self.shortVersion]');
        assert.match(postInstallSrc, /_mainJsonPath[\s\S]{0,800}?def_global_mode/,
            'post_install.js must update def_global_mode in root main.json');
    });

    it('writes def_global_mode[shortVersion] to per-version main.json when present', function () {
        assert.match(postInstallSrc, /_versionMainPath[\s\S]{0,800}?def_global_mode/,
            'post_install.js must update def_global_mode in per-version main.json');
        assert.match(postInstallSrc, /'\/\.gina\/'\s*\+\s*self\.shortVersion\s*\+\s*'\/main\.json'/,
            'post_install.js must target ~/.gina/{shortVersion}/main.json');
    });

    it('wraps the seed block in try/catch with a console.warn fallback', function () {
        var seed = postInstallSrc.match(/Seed def_global_mode[\s\S]{0,3000}?console\.warn\([^)]*def_global_mode/);
        assert.ok(seed, 'post_install.js must wrap the def_global_mode seed in try/catch');
    });

    it('runs after the def_framework sync block', function () {
        var dfIdx = postInstallSrc.indexOf('Sync main.json def_framework');
        var gmIdx = postInstallSrc.indexOf('Seed def_global_mode');
        assert.ok(dfIdx > -1, 'def_framework sync block missing');
        assert.ok(gmIdx > -1, 'def_global_mode seed block missing');
        assert.ok(gmIdx > dfIdx, 'def_global_mode seed must run after def_framework sync');
    });
});
