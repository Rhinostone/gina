/**
 * project:add — linkGina self-resolved CLI invocation.
 *
 * Locks the fix for the scaffolded-bundle MODULE_NOT_FOUND boot crash: linkGina
 * used to create the project's `node_modules/gina` symlink by shelling out to a
 * PATH-resolved `gina link @<project>` and silently swallowed the failure
 * (`onSuccess(err)`), so on a host without the binary on PATH (a repo checkout
 * where `npm install --ignore-scripts` skipped bin linking) project:add reported
 * success while the project had no gina symlink — and the bundle's framework
 * require crashed at boot.
 *
 * The fix:
 *   (a) spawn the running install's OWN CLI — `[process.execPath, <root>/bin/cli,
 *       'link', '@<project>']` (array form, path resolved from add.js's location);
 *   (b) verify the actual postcondition (the symlink exists) instead of trusting
 *       the Shell err channel (which reports any stderr output as an error);
 *   (c) route genuine failures through the (previously dead) onError parameter.
 *
 * §05 covers the same defect class in framework/link.js's stale-node_modules
 * repair path: `execSync('$(which gina) link-node-modules ...')` was PATH-resolved
 * AND its `instanceof Error` check was dead code (execSync throws on failure, it
 * never returns an Error) — now a self-resolved CLI invocation wrapped in
 * try/catch routing failures through end().
 *
 * Run standalone:
 *   node --test test/lib/project-add-link.test.js
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var FW = require('../fw');
var ADD_PATH = path.join(FW, 'lib/cmd/project/add.js');
var SRC = fs.readFileSync(ADD_PATH, 'utf8');

// linkGina slice — from its declaration to the end of the constructor body
var lgIdx = SRC.indexOf('var linkGina = function');
var LG = (lgIdx > -1) ? SRC.slice(lgIdx, SRC.indexOf('init()', lgIdx)) : '';

// Strips /* */ blocks and full-or-trailing // line comments so negative pins
// don't trip on the `// was:` historical lines kept next to the new code.
function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map(function(line) { return line.replace(/^\s*\/\/.*$/, ''); })
        .join('\n');
}


// ── 01 — Source pins: self-resolved CLI spawn ───────────────────────────────

describe('01 - linkGina spawns the running install\'s own CLI (not a PATH-resolved binary)', function() {

    it('linkGina is declared in project/add.js', function() {
        assert.ok(lgIdx > -1, 'var linkGina = function not found in ' + ADD_PATH);
    });

    it('uses the array form of Shell.run with process.execPath as argv[0]', function() {
        assert.ok(
            LG.indexOf('.run([ process.execPath,') > -1,
            'expected `.run([ process.execPath, ...], true)` — the array form avoids Shell.run\'s split-on-space'
        );
    });

    it('resolves the CLI path from __dirname, targeting bin/cli', function() {
        assert.match(
            LG,
            /require\('path'\)\.resolve\(__dirname,\s*'\.\.\/\.\.\/\.\.\/\.\.\/\.\.'\s*,\s*'bin\/cli'\)/,
            'expected the CLI path resolved from add.js\'s own location (framework/link.js rationale)'
        );
    });

    it('still passes the link task and the @<project> argument', function() {
        assert.match(LG, /'link',\s*'@'\+\s*self\.projectName\s*\],\s*true\)/);
    });

    it('no live PATH-resolved `gina link` call remains (comment-stripped)', function() {
        var live = stripComments(LG);
        assert.ok(
            live.indexOf(".run('gina link") < 0,
            'found a live string-form `gina link` Shell call — PATH-resolved self-invocation must not come back'
        );
    });

});


// ── 02 — Resolution replica against the real tree ───────────────────────────

describe('02 - the __dirname-resolved CLI path is the repo\'s bin/cli', function() {

    var resolved = path.resolve(path.dirname(ADD_PATH), '../../../../..', 'bin/cli');
    var expected = path.resolve(FW, '../..', 'bin', 'cli');

    it('resolves to <gina root>/bin/cli', function() {
        assert.equal(resolved, expected);
    });

    it('the resolved CLI exists on disk', function() {
        assert.ok(fs.existsSync(resolved), resolved + ' does not exist');
    });

});


// ── 03 — Source pins: postcondition check + onError wiring ──────────────────

describe('03 - linkGina verifies the symlink postcondition and surfaces failures via onError', function() {

    it('checks fs.existsSync on the project\'s node_modules/gina inside onComplete', function() {
        assert.ok(LG.indexOf("_(self.projectLocation + '/node_modules/gina', true)") > -1);
        assert.ok(LG.indexOf('if ( !fs.existsSync(ginaModule) )') > -1);
    });

    it('calls onError(err) on the missing-symlink branch', function() {
        var guardIdx = LG.indexOf('if ( !fs.existsSync(ginaModule) )');
        var errIdx   = LG.indexOf('return onError(err)', guardIdx);
        assert.ok(guardIdx > -1 && errIdx > guardIdx, 'expected `return onError(err)` after the !existsSync guard');
    });

    it('the old error-swallowing onSuccess(err) shape is gone (comment-stripped)', function() {
        assert.ok(
            stripComments(LG).indexOf('onSuccess(err)') < 0,
            'a failed link must no longer be routed through onSuccess'
        );
    });

});


// ── 04 — Pure-logic replica: postcondition gating ────────────────────────────

describe('04 - onComplete decision replica (postcondition wins over the Shell err channel)', function() {

    // Mirrors linkGina's onComplete branch logic line-for-line.
    function replica(linked, err, onError, onSuccess) {
        if (!linked) {
            err = new Error('Could not create the gina symlink' + (err ? '\n' + (err.stack || err) : ''));
            return onError(err);
        }
        onSuccess();
    }

    it('symlink present + stderr noise from the Shell → success (noise tolerated)', function() {
        var ok = false, ko = false;
        replica(true, 'Error: some warning printed to stderr', function() { ko = true; }, function() { ok = true; });
        assert.ok(ok && !ko, 'stderr noise must not fail a link whose postcondition holds');
    });

    it('symlink missing + Shell err → onError with both messages', function() {
        var got = null;
        replica(false, 'spawn gina ENOENT', function(e) { got = e; }, function() {});
        assert.ok(got instanceof Error);
        assert.ok(got.message.indexOf('Could not create the gina symlink') > -1);
        assert.ok(got.message.indexOf('spawn gina ENOENT') > -1);
    });

    it('symlink missing with no Shell err → still onError', function() {
        var got = null;
        replica(false, null, function(e) { got = e; }, function() {});
        assert.ok(got instanceof Error);
    });

});


// ── 05 — framework/link.js sibling: stale-node_modules repair path ───────────

describe('05 - framework:link stale-node_modules repair uses the self-resolved CLI in a try/catch', function() {

    var LINK_PATH = path.join(FW, 'lib/cmd/framework/link.js');
    var LINK_SRC = fs.readFileSync(LINK_PATH, 'utf8');

    it('no live PATH-resolved $(which gina) invocation remains (comment-stripped)', function() {
        assert.ok(
            stripComments(LINK_SRC).indexOf('$(which gina)') < 0,
            'found a live `$(which gina)` self-invocation in framework/link.js'
        );
    });

    it('invokes the running install\'s own CLI via process.execPath', function() {
        assert.ok(LINK_SRC.indexOf('execSync(\'"\'+ process.execPath +\'" "\'+ cli +\'" link-node-modules @\'+ self.projectName)') > -1);
    });

    it('resolves the CLI path from __dirname, targeting bin/cli', function() {
        assert.match(
            LINK_SRC,
            /var cli = require\('path'\)\.resolve\(__dirname,\s*'\.\.\/\.\.\/\.\.\/\.\.\/\.\.'\s*,\s*'bin\/cli'\)/
        );
    });

    it('the __dirname-resolved CLI path from link.js is the repo\'s bin/cli and exists', function() {
        var resolved = path.resolve(path.dirname(LINK_PATH), '../../../../..', 'bin/cli');
        assert.equal(resolved, path.resolve(FW, '../..', 'bin', 'cli'));
        assert.ok(fs.existsSync(resolved));
    });

    it('the execSync is wrapped in try/catch routing the failure through end() — the dead instanceof check is gone', function() {
        var tryIdx   = LINK_SRC.indexOf('try {');
        var execIdx  = LINK_SRC.indexOf('execSync(\'"\'+ process.execPath');
        var catchIdx = LINK_SRC.indexOf('catch (linkErr)');
        assert.ok(tryIdx > -1 && execIdx > tryIdx && catchIdx > execIdx, 'expected try { execSync(...) } catch (linkErr)');
        assert.match(LINK_SRC.slice(catchIdx, catchIdx + 400), /return end\(new Error\(errOutput\), 'error'\)/);
        // execSync never RETURNS an Error — the old `err = execSync(...); if (err instanceof Error)` was dead code
        assert.ok(
            stripComments(LINK_SRC).indexOf('err = execSync') < 0,
            'the dead `err = execSync(...)` assignment shape must not come back'
        );
    });

});
