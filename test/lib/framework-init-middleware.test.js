/**
 * framework:init — MIDDLEWARE first-use creation (Bun install-lifecycle, Stage 3)
 *
 * Why source inspection + simulation instead of requiring the module:
 *   init.js depends on injected globals (lib.logger, getPath, getEnvVar, _) only
 *   present inside a running gina process, so it cannot be required in a bare
 *   node:test context — the same constraint init-migration.test.js documents.
 *
 * Background: the framework-dir MIDDLEWARE file is normally written by
 * script/post_install.js, but it is gitignored + npmignored and any environment
 * that skips the install lifecycle never receives it — most notably the Bun
 * runtime (`bun add -g` blocks dependency postinstalls by default), and also
 * containers / fresh clones. checkIfMiddlewareFile recreates it at framework:init
 * time, ahead of the command dispatch, so the readers (version.js, config.js)
 * get the real value instead of crashing.
 *
 * Covers:
 *   (a) source structure — the create-when-missing branch is gated on existsSync,
 *       writes isaac@<version>, is best-effort (try/catch), and never done(err)
 *   (b) the create-when-missing contract simulated inline (idempotent, content,
 *       non-fatal on a read-only framework dir)
 */
'use strict';

var fs     = require('fs');
var path   = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var SOURCE_PATH = path.join(require('../fw'), 'lib/cmd/framework/init.js');
var src = fs.readFileSync(SOURCE_PATH, 'utf8');

/**
 * Slice the checkIfMiddlewareFile body — end-anchored on the NEXT step
 * declaration (checkIfMain) so the window cannot silently drift past it, and
 * start-anchored on the function declaration so the JSDoc above it is excluded.
 */
function middlewareBlock() {
    var start = src.indexOf('self.checkIfMiddlewareFile = function');
    var end   = src.indexOf('self.checkIfMain = function', start);
    assert.ok(start > -1 && end > start, 'could not slice checkIfMiddlewareFile body');
    // Strip line comments so the negative code-absence pins below (e.g. no
    // `done(err)`) don't trip on the function's own explanatory comments —
    // the jsdoc.md "negative pin trips on the file's own comment" trap. No `//`
    // appears inside string literals in this block, so this is loss-free for the
    // positive pins, which all match code tokens.
    return src.slice(start, end).replace(/\/\/[^\n]*/g, '');
}


// ---------------------------------------------------------------------------
// 01 — source structure: create-when-missing
// ---------------------------------------------------------------------------
describe('01 - checkIfMiddlewareFile create-when-missing source', function() {

    it('gates the create branch on a missing file (!existsSync)', function() {
        assert.ok(
            /if\s*\(\s*!middlewareFileObj\.existsSync\(\)\s*\)/.test(middlewareBlock()),
            'expected the create branch gated on !middlewareFileObj.existsSync()'
        );
    });

    it('writes the file with fs.writeFileSync', function() {
        assert.ok(
            middlewareBlock().indexOf('fs.writeFileSync(') > -1,
            'expected fs.writeFileSync in the create branch'
        );
    });

    it('builds the content as isaac@<version> (matches post_install default)', function() {
        assert.ok(
            /'isaac@'\s*\+\s*version/.test(middlewareBlock()),
            "expected the content to be 'isaac@' + version"
        );
    });

    it('sources the version from GINA_VERSION with a package.json fallback', function() {
        var blk = middlewareBlock();
        assert.ok(blk.indexOf("getEnvVar('GINA_VERSION')") > -1, 'expected the GINA_VERSION source');
        assert.ok(
            /require\(opt\.frameworkPath \+ '\/package\.json'\)\.version/.test(blk),
            'expected the framework package.json version fallback'
        );
    });

    it('wraps creation in try/catch (best-effort, non-fatal)', function() {
        assert.ok(
            middlewareBlock().indexOf('catch (writeErr)') > -1,
            'expected the write wrapped in try/catch (writeErr)'
        );
    });

    it('never passes an error to done() — begin() treats a step error as fatal', function() {
        var blk = middlewareBlock();
        assert.ok(blk.indexOf('done()') > -1, 'expected a bare done()');
        assert.ok(blk.indexOf('done(writeErr)') < 0, 'must NOT done(writeErr)');
        assert.ok(blk.indexOf('done(err') < 0, 'must NOT pass any error to done()');
    });

});


// ---------------------------------------------------------------------------
// 02 — create-when-missing contract (pure-logic replica)
// ---------------------------------------------------------------------------
describe('02 - MIDDLEWARE ensure logic', function() {

    /**
     * Mirror of the checkIfMiddlewareFile create-when-missing branch.
     * @param {{exists:boolean, content:(string|null), readonly:boolean}} state
     * @param {string} version
     * @returns {object} the mutated state
     */
    function ensureMiddleware(state, version) {
        if (state.exists) {
            return state; // idempotent — present, untouched (the Node happy path)
        }
        try {
            if (state.readonly) { throw new Error('EROFS: read-only file system'); }
            state.content = 'isaac@' + version;
            state.exists  = true;
        } catch (writeErr) {
            // non-fatal: leave absent; version.js degrades to 'none'
        }
        return state;
    }

    it('creates isaac@<version> when the file is missing', function() {
        var s = ensureMiddleware({ exists: false, content: null, readonly: false }, '0.5.5-alpha.2');
        assert.equal(s.exists, true);
        assert.equal(s.content, 'isaac@0.5.5-alpha.2');
    });

    it('is a no-op when the file already exists (idempotent / Node happy path)', function() {
        // create-if-MISSING, not update-if-stale: an existing (even stale) value is left intact
        var s = ensureMiddleware({ exists: true, content: 'isaac@0.5.5-alpha.1', readonly: false }, '0.5.5-alpha.2');
        assert.equal(s.content, 'isaac@0.5.5-alpha.1');
    });

    it('degrades non-fatally when the framework dir is read-only', function() {
        var s = ensureMiddleware({ exists: false, content: null, readonly: true }, '0.5.5-alpha.2');
        assert.equal(s.exists, false);  // still absent
        assert.equal(s.content, null);  // no throw escapes — version.js falls back to 'none'
    });

});
