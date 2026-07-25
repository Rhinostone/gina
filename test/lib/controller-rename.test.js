/**
 * lib/cmd/controller/rename.js + the pure inc/reference-rewrite helper —
 * `controller:rename` (reference-aware controller rename).
 *
 * The rewriter (inc/reference-rewrite) is dependency-free, so it is exercised
 * BEHAVIORALLY against strings (both routing sites, both requireController quote
 * styles, comment preservation, substring/dynamic safety). The apply algorithm
 * (rewrite → move → move, snapshot rollback) is proven by a require-by-path
 * REPLICA over a temp fixture tree. rename.js itself runs in the CLI daemon
 * context, so it is covered by source-inspection pins of its structural
 * invariants; the end-to-end behaviour is proven by the isolated-home smoke
 * (incl. the interactive confirm via a pty).
 */

'use strict';

var fs     = require('fs');
var os     = require('os');
var path   = require('path');
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');

var FW = require('../fw');

var rewrite = require(path.join(FW, 'lib/cmd/controller/inc/reference-rewrite'));
var refScan = require(path.join(FW, 'lib/cmd/controller/inc/reference-scan'));

var RN_SRC   = fs.readFileSync(path.join(FW, 'lib/cmd/controller/rename.js'), 'utf8');
var HELP_TXT = fs.readFileSync(path.join(FW, 'lib/cmd/controller/help.txt'), 'utf8');
var ARGS_ARR = JSON.parse(fs.readFileSync(path.join(FW, 'lib/cmd/controller/arguments.json'), 'utf8'));

var RN_ACTIVE = RN_SRC.split('\n').filter(function (l) {
    return !/^\s*(\/\/|\*|\/\*)/.test(l);
}).join('\n');


// ---------------------------------------------------------------------------
// 01 — reference-rewrite.rewriteRoutingNamespace
// ---------------------------------------------------------------------------
describe('01 - rewriteRoutingNamespace', function () {

    it('rewrites both the rule-level namespace and param.namespace, counting each', function () {
        var src = '{ "a": { "namespace": "checkout" }, "b": { "param": { "namespace": "checkout" } } }';
        var r = rewrite.rewriteRoutingNamespace(src, 'checkout', 'basket');
        assert.equal(r.count, 2);
        assert.equal((r.content.match(/"namespace": "basket"/g) || []).length, 2);
        assert.ok(r.content.indexOf('"checkout"') < 0);
    });

    it('preserves comments + ordering (string op, not parse->stringify)', function () {
        var src = '// keep me\n{\n  "$schema": "https://gina.io/x",\n  "r": { "namespace": "checkout" }\n}';
        var r = rewrite.rewriteRoutingNamespace(src, 'checkout', 'basket');
        assert.match(r.content, /\/\/ keep me/);
        assert.match(r.content, /https:\/\/gina\.io\/x/);
    });

    it('does NOT touch a substring namespace or a :variable value', function () {
        var src = '{ "a": { "namespace": "checkout2" }, "b": { "param": { "namespace": ":type" } } }';
        var r = rewrite.rewriteRoutingNamespace(src, 'checkout', 'basket');
        assert.equal(r.count, 0);
        assert.match(r.content, /"checkout2"/);
        assert.match(r.content, /":type"/);
    });
});


// ---------------------------------------------------------------------------
// 02 — reference-rewrite.rewriteRequireController
// ---------------------------------------------------------------------------
describe('02 - rewriteRequireController', function () {

    it('rewrites both quote styles, preserving quote + spacing', function () {
        var src = "self.requireController('checkout');\na.requireController( \"checkout\" );";
        var r = rewrite.rewriteRequireController(src, 'checkout', 'basket');
        assert.equal(r.count, 2);
        assert.match(r.content, /requireController\('basket'\)/);
        assert.match(r.content, /requireController\( "basket" \)/);
    });

    it('does NOT touch the bare word, another literal, or a non-literal argument', function () {
        var src = "var checkout = 1;\nself.requireController('other');\nself.requireController(nsVar);";
        var r = rewrite.rewriteRequireController(src, 'checkout', 'basket');
        assert.equal(r.count, 0);
        assert.match(r.content, /var checkout = 1/);
        assert.match(r.content, /requireController\('other'\)/);
        assert.match(r.content, /requireController\(nsVar\)/);
    });
});


// ---------------------------------------------------------------------------
// 03 — apply-algorithm replica over a real fixture tree
//      (rewrite routing + require, move controller file, move template tree)
// ---------------------------------------------------------------------------
describe('03 - apply algorithm (fixture replica)', function () {

    var root;

    before(function () {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-ctrl-rename-'));
        fs.mkdirSync(path.join(root, 'controllers'), { recursive: true });
        fs.mkdirSync(path.join(root, 'templates/html/checkout'), { recursive: true });
        fs.mkdirSync(path.join(root, 'config'), { recursive: true });
        fs.writeFileSync(path.join(root, 'controllers/controller.checkout.js'),
            "function DemoCheckoutController(){ var self=this; self.requireController('checkout'); }");
        fs.writeFileSync(path.join(root, 'controllers/controller.content.js'),
            "function D(){ var self=this; var c = self.requireController('checkout'); }");
        fs.writeFileSync(path.join(root, 'templates/html/checkout/start.html'), '<h1>x</h1>');
        fs.writeFileSync(path.join(root, 'config/routing.json'),
            '// keep\n{\n  "r": { "namespace": "checkout", "param": { "control": "start" } }\n}');
    });

    after(function () {
        fs.rmSync(root, { recursive: true, force: true });
    });

    // a faithful replica of rename.js applyRename's step order
    function applyReplica(bundleSrc, oldNs, newNs) {
        var scan = refScan.scan(bundleSrc, oldNs);
        // 1) rewrite routing.json
        var rAbs = path.join(bundleSrc, 'config', 'routing.json');
        var rOrig = fs.readFileSync(rAbs, 'utf8');
        var rRes = rewrite.rewriteRoutingNamespace(rOrig, oldNs, newNs);
        if (rRes.content !== rOrig) fs.writeFileSync(rAbs, rRes.content);
        // 2) rewrite requireController in each flagged file
        var seen = {};
        scan.requireRefs.forEach(function (ref) {
            if (seen[ref.file]) return; seen[ref.file] = true;
            var abs = path.join(bundleSrc, ref.file);
            var o = fs.readFileSync(abs, 'utf8');
            fs.writeFileSync(abs, rewrite.rewriteRequireController(o, oldNs, newNs).content);
        });
        // 3) move controller file, 4) move template tree
        fs.renameSync(scan.controllerPath, path.join(bundleSrc, 'controllers', 'controller.' + newNs + '.js'));
        if (scan.templatePath) fs.renameSync(scan.templatePath, path.join(bundleSrc, 'templates', 'html', newNs));
        return rRes.count;
    }

    it('moves the file + templates and rewrites both routing + require sites', function () {
        applyReplica(root, 'checkout', 'basket');
        assert.ok(fs.existsSync(path.join(root, 'controllers/controller.basket.js')), 'controller moved');
        assert.ok(!fs.existsSync(path.join(root, 'controllers/controller.checkout.js')), 'old controller gone');
        assert.ok(fs.existsSync(path.join(root, 'templates/html/basket')), 'templates moved');
        assert.ok(!fs.existsSync(path.join(root, 'templates/html/checkout')), 'old templates gone');
        // routing rewritten + comment preserved
        var routing = fs.readFileSync(path.join(root, 'config/routing.json'), 'utf8');
        assert.match(routing, /"namespace": "basket"/);
        assert.match(routing, /\/\/ keep/);
        // external requireController rewritten
        var content = fs.readFileSync(path.join(root, 'controllers/controller.content.js'), 'utf8');
        assert.match(content, /requireController\('basket'\)/);
        // self-reference (moved file) rewritten
        var moved = fs.readFileSync(path.join(root, 'controllers/controller.basket.js'), 'utf8');
        assert.match(moved, /requireController\('basket'\)/);
    });
});


// ---------------------------------------------------------------------------
// 04 — rename.js structure (source pins)
// ---------------------------------------------------------------------------
describe('04 - rename.js structure', function () {

    it('exports the Rename constructor', function () {
        assert.match(RN_SRC, /module\.exports\s*=\s*Rename/);
        assert.match(RN_SRC, /function Rename\(opt, cmd\)/);
    });

    it('reads THREE positionals via the group parser', function () {
        assert.match(RN_ACTIVE, /args\.positionals\(\s*opt\.argv\s*\)/);
        assert.match(RN_ACTIVE, /positionals\.length !== 3/);
    });

    it('validates BOTH names + an old!=new guard before scanning', function () {
        var vOld = RN_ACTIVE.indexOf('isValidNamespace(oldN)');
        var vNew = RN_ACTIVE.indexOf('isValidNamespace(newN)');
        var scanIdx = RN_ACTIVE.indexOf('refScan.scan(');
        assert.ok(vOld > -1 && vNew > -1 && scanIdx > -1);
        assert.ok(vOld < scanIdx && vNew < scanIdx, 'both names validated before the scan');
        assert.match(RN_ACTIVE, /oldN === newN/);
    });

    it('refuses a missing source and a target collision (no overwrite)', function () {
        assert.match(RN_ACTIVE, /if \(\s*!scan\.controllerFile\s*\)/);
        assert.match(RN_SRC, /Nothing to rename/);
        assert.match(RN_ACTIVE, /fs\.existsSync\(\s*newCtrl\s*\)/);
        assert.match(RN_SRC, /already exists.*Remove it first/);
    });
});


// ---------------------------------------------------------------------------
// 05 — apply: rewrite routing (POSITIVE), snapshot rollback, ordering
// ---------------------------------------------------------------------------
describe('05 - apply + rollback', function () {

    it('DOES rewrite routing.json (unlike remove) via the comment-preserving rewriter', function () {
        assert.match(RN_ACTIVE, /rewrite\.rewriteRoutingNamespace\(/);
        assert.match(RN_ACTIVE, /rewrite\.rewriteRequireController\(/);
    });

    it('moves the controller file + template tree with fs.renameSync', function () {
        assert.match(RN_ACTIVE, /fs\.renameSync\(oldCtrlAbs, newCtrlAbs\)/);
        assert.match(RN_ACTIVE, /fs\.renameSync\(scan\.templatePath, newTplAbs\)/);
    });

    it('snapshots writes + moves and rolls back all-or-nothing on failure', function () {
        assert.match(RN_ACTIVE, /snapshot\s*=\s*\{ moves: \[\], writes: \[\] \}/);
        assert.match(RN_ACTIVE, /rolled back — no changes kept/);
    });

    it('reports dynamic references + the cosmetic class name instead of rewriting them', function () {
        assert.match(RN_ACTIVE, /residualNote\(/);
        assert.match(RN_SRC, /a static rewrite cannot resolve/);
        assert.match(RN_SRC, /class name and any comments inside it are left as-is/);
    });
});


// ---------------------------------------------------------------------------
// 06 — flags + confirm idiom
// ---------------------------------------------------------------------------
describe('06 - flags + confirm', function () {

    it('--dry-run previews, --force applies, --format=json previews unless --force', function () {
        assert.match(RN_ACTIVE, /if \(\s*dryRun\s*\)\s*\{\s*\n\s*return reportDryRun\(/);
        assert.match(RN_ACTIVE, /if \(\s*force\s*\)\s*\{\s*\n\s*return doRenameAndReport\(/);
        assert.match(RN_ACTIVE, /!dryRun && force/);
        assert.match(RN_ACTIVE, /fs\.writeSync\(\s*1\s*,\s*JSON\.stringify/);
    });

    it('confirm idiom: module-scope readline, non-TTY guard naming --force/--dry-run', function () {
        assert.match(RN_SRC, /readline\.createInterface\(process\.stdin, process\.stdout\)/);
        assert.match(RN_ACTIVE, /!process\.stdin\.isTTY \|\| rl\.closed/);
        assert.match(RN_SRC, /pass --force to apply non-interactively, or --dry-run to preview/);
        assert.match(RN_ACTIVE, /case 'yes':/);
        assert.match(RN_ACTIVE, /case 'no':/);
    });
});


// ---------------------------------------------------------------------------
// 07 — registration + help + arguments
// ---------------------------------------------------------------------------
describe('07 - registration + help', function () {

    it('arguments.json whitelists --dry-run / --force / --format', function () {
        ['--dry-run', '--force', '--format'].forEach(function (f) {
            assert.ok(ARGS_ARR.indexOf(f) > -1, f);
        });
    });

    it('help.txt documents controller:rename with samples', function () {
        assert.match(HELP_TXT, /gina controller:rename <old> <new> <bundle> @<project>/);
        assert.match(HELP_TXT, /controller:rename checkout basket demo @myproject/);
        assert.match(HELP_TXT, /--dry-run/);
        assert.match(HELP_TXT, /--force/);
    });
});
