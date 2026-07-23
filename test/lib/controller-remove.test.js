/**
 * lib/cmd/controller/remove.js + rm.js + the pure inc/reference-scan helper —
 * `controller:remove` (reference-aware controller deletion).
 *
 * The scanner (inc/reference-scan) is dependency-free (node fs/path only, no
 * framework globals), so it is exercised BEHAVIORALLY: the pure content
 * analyzers against strings, and scan() against a real temp fixture tree. The
 * remove.js handler runs inside the CLI daemon context (CmdHelper + gina globals),
 * heavy to replicate for near-zero extra coverage, so it is covered by
 * source-inspection pins of its structural invariants — chiefly the negative
 * "never writes routing.json" (the print-only-for-references contract), the
 * refuse-unless-clean gate, and the readline confirm idiom. The end-to-end
 * behaviour (refusal / dry-run / force / json) is proven by the isolated-home
 * smoke.
 */

'use strict';

var fs     = require('fs');
var os     = require('os');
var path   = require('path');
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');

var FW = require('../fw');

// pure helper — loaded directly (no framework globals)
var refScan = require(path.join(FW, 'lib/cmd/controller/inc/reference-scan'));

// handler + config — read as source
var RM_SRC   = fs.readFileSync(path.join(FW, 'lib/cmd/controller/remove.js'), 'utf8');
var RMALIAS  = fs.readFileSync(path.join(FW, 'lib/cmd/controller/rm.js'), 'utf8');
var HELP_TXT = fs.readFileSync(path.join(FW, 'lib/cmd/controller/help.txt'), 'utf8');
var ARGS_ARR = JSON.parse(fs.readFileSync(path.join(FW, 'lib/cmd/controller/arguments.json'), 'utf8'));

// comment-stripped handler source for negative code-absence pins (so a pin never
// trips on the module's own JSDoc)
var RM_ACTIVE = RM_SRC.split('\n').filter(function (l) {
    return !/^\s*(\/\/|\*|\/\*)/.test(l);
}).join('\n');


// ---------------------------------------------------------------------------
// 01 — reference-scan: stripJsonComments (string-aware)
// ---------------------------------------------------------------------------
describe('01 - reference-scan.stripJsonComments', function () {

    it('drops // and block comments', function () {
        var out = refScan.stripJsonComments('// head\n{ /* mid */ "a": 1 } // tail');
        assert.ok(out.indexOf('head') < 0);
        assert.ok(out.indexOf('mid') < 0);
        assert.ok(out.indexOf('tail') < 0);
        assert.deepEqual(JSON.parse(out), { a: 1 });
    });

    it('does NOT corrupt // inside a string value (a $schema URL)', function () {
        var txt = '{ "$schema": "https://gina.io/schema/routing.json", "a": 1 }';
        var out = refScan.stripJsonComments(txt);
        assert.match(out, /https:\/\/gina\.io\/schema\/routing\.json/);
        assert.equal(JSON.parse(out)['$schema'], 'https://gina.io/schema/routing.json');
    });
});


// ---------------------------------------------------------------------------
// 02 — reference-scan: findRoutingRefs
// ---------------------------------------------------------------------------
describe('02 - reference-scan.findRoutingRefs', function () {

    var routing = [
        '// bundle needs a restart',
        '{',
        '  "$schema": "https://gina.io/schema/routing.json",',
        '  "checkout-start": { "namespace": "checkout", "param": { "control": "start" } },',
        '  "legacy":         { "url": "/x", "param": { "namespace": "checkout" } },',
        '  "dyn":            { "param": { "namespace": ":type" } },',
        '  "other":          { "namespace": "account" }',
        '}'
    ].join('\n');

    it('finds a rule-level namespace AND a param.namespace as literal refs', function () {
        var r = refScan.findRoutingRefs(routing, 'checkout');
        assert.equal(r.parseError, null);
        assert.deepEqual(r.refs, [
            { rule: 'checkout-start', site: 'namespace' },
            { rule: 'legacy', site: 'param.namespace' }
        ]);
    });

    it('flags a :variable param.namespace as DYNAMIC, not a literal match', function () {
        var r = refScan.findRoutingRefs(routing, 'checkout');
        assert.equal(r.dynamic.length, 1);
        assert.equal(r.dynamic[0].rule, 'dyn');
        assert.equal(r.dynamic[0].value, ':type');
    });

    it('ignores $schema and rules that name a different namespace', function () {
        var r = refScan.findRoutingRefs(routing, 'account');
        assert.deepEqual(r.refs, [{ rule: 'other', site: 'namespace' }]);
        // no $schema string treated as a rule
        assert.ok(r.refs.every(function (x) { return x.rule !== '$schema'; }));
    });

    it('reports a parse error rather than throwing on malformed JSON', function () {
        var r = refScan.findRoutingRefs('{ "a": }', 'checkout');
        assert.ok(typeof r.parseError === 'string' && r.parseError.length > 0);
        assert.deepEqual(r.refs, []);
    });
});


// ---------------------------------------------------------------------------
// 03 — reference-scan: findRequireRefs
// ---------------------------------------------------------------------------
describe('03 - reference-scan.findRequireRefs', function () {

    it('matches both quote styles as literal refs, with line numbers', function () {
        var js = [
            "var a = self.requireController('checkout');",
            'var b = self.requireController("checkout");'
        ].join('\n');
        var r = refScan.findRequireRefs(js, 'checkout');
        assert.deepEqual(r.refs, [{ line: 1 }, { line: 2 }]);
        assert.deepEqual(r.dynamic, []);
    });

    it('ignores a literal call naming a different namespace, and an empty call', function () {
        var js = "self.requireController('other');\nself.requireController();";
        var r = refScan.findRequireRefs(js, 'checkout');
        assert.deepEqual(r.refs, []);
        assert.deepEqual(r.dynamic, []);
    });

    it('flags a non-literal argument as DYNAMIC (variable, not resolvable)', function () {
        var js = 'var c = self.requireController(nsVar);';
        var r = refScan.findRequireRefs(js, 'checkout');
        assert.deepEqual(r.refs, []);
        assert.deepEqual(r.dynamic, [{ line: 1 }]);
    });
});


// ---------------------------------------------------------------------------
// 04 — reference-scan: scan() over a real fixture tree
// ---------------------------------------------------------------------------
describe('04 - reference-scan.scan (fixture tree)', function () {

    var root;

    before(function () {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-ctrl-scan-'));
        fs.mkdirSync(path.join(root, 'controllers'), { recursive: true });
        fs.mkdirSync(path.join(root, 'templates/html/checkout'), { recursive: true });
        fs.mkdirSync(path.join(root, 'config'), { recursive: true });
        // the controller being scanned + a self-reference (moot on delete)
        fs.writeFileSync(path.join(root, 'controllers/controller.checkout.js'),
            "function X(){ var self=this; self.requireController('checkout'); }");
        // the default controller with an EXTERNAL requireController blocker
        fs.writeFileSync(path.join(root, 'controllers/controller.js'),
            "function D(){ var self=this; var c = self.requireController('checkout'); }");
        // a template file
        fs.writeFileSync(path.join(root, 'templates/html/checkout/start.html'), '<h1>x</h1>');
        // routing.json with a comment, $schema, rule-level namespace, param.namespace, a :var
        fs.writeFileSync(path.join(root, 'config/routing.json'), [
            '// restart on change',
            '{',
            '  "$schema": "https://gina.io/schema/routing.json",',
            '  "checkout-start": { "namespace": "checkout", "param": { "control": "start" } },',
            '  "legacy": { "param": { "namespace": "checkout" } },',
            '  "dyn": { "param": { "namespace": ":type" } }',
            '}'
        ].join('\n'));
    });

    after(function () {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('locates the controller file and template dir', function () {
        var r = refScan.scan(root, 'checkout');
        assert.equal(r.controllerFile, 'controllers/controller.checkout.js');
        assert.equal(r.templateDir, 'templates/html/checkout');
        assert.ok(r.controllerPath.endsWith('controllers/controller.checkout.js'));
    });

    it('collects both routing sites as literal refs', function () {
        var r = refScan.scan(root, 'checkout');
        assert.deepEqual(r.routingRefs, [
            { file: 'config/routing.json', rule: 'checkout-start', site: 'namespace' },
            { file: 'config/routing.json', rule: 'legacy', site: 'param.namespace' }
        ]);
    });

    it('collects requireController refs across the .js tree (incl. the self-ref)', function () {
        var r = refScan.scan(root, 'checkout');
        var files = r.requireRefs.map(function (x) { return x.file; }).sort();
        assert.deepEqual(files, ['controllers/controller.checkout.js', 'controllers/controller.js']);
    });

    it('surfaces the :variable param.namespace as an advisory dynamic ref', function () {
        var r = refScan.scan(root, 'checkout');
        var dyn = r.dynamicRefs.filter(function (d) { return d.kind === 'routing-namespace'; });
        assert.equal(dyn.length, 1);
        assert.equal(dyn[0].value, ':type');
    });

    it('reports null for an absent controller / template dir', function () {
        var r = refScan.scan(root, 'ghost');
        assert.equal(r.controllerFile, null);
        assert.equal(r.templateDir, null);
        assert.deepEqual(r.routingRefs, []);
    });
});


// ---------------------------------------------------------------------------
// 05 — remove.js structure (source pins)
// ---------------------------------------------------------------------------
describe('05 - remove.js structure', function () {

    it('exports the Remove constructor', function () {
        assert.match(RM_SRC, /module\.exports\s*=\s*Remove/);
        assert.match(RM_SRC, /function Remove\(opt, cmd\)/);
    });

    it('reads positionals via the group parser, not self.bundles', function () {
        assert.match(RM_ACTIVE, /args\.positionals\(\s*opt\.argv\s*\)/);
        assert.doesNotMatch(RM_ACTIVE, /self\.bundles\[/);
    });

    it('validates the namespace BEFORE scanning', function () {
        var vIdx = RM_ACTIVE.indexOf('ns.isValidNamespace(');
        var sIdx = RM_ACTIVE.indexOf('refScan.scan(');
        assert.ok(vIdx > -1 && sIdx > -1);
        assert.ok(vIdx < sIdx, 'namespace validated before the scan runs');
    });

    it('refuses when the controller file does not exist', function () {
        assert.match(RM_ACTIVE, /if \(\s*!scan\.controllerFile\s*\)/);
        assert.match(RM_SRC, /Nothing to remove/);
    });

    it('deletes via fs.rmSync (file + recursive template tree)', function () {
        assert.match(RM_ACTIVE, /fs\.rmSync\(\s*scan\.controllerPath/);
        assert.match(RM_ACTIVE, /fs\.rmSync\(\s*scan\.templatePath,\s*\{\s*recursive:\s*true/);
    });
});


// ---------------------------------------------------------------------------
// 06 — refuse-unless-clean + the negative invariant
// ---------------------------------------------------------------------------
describe('06 - refuse-unless-clean + never-writes-routing', function () {

    it('refuses (exit 1) when blocking references remain and no --force', function () {
        assert.match(RM_ACTIVE, /b\.count > 0 && !force/);
        assert.match(RM_ACTIVE, /reportRefusal\(/);
        assert.match(RM_SRC, /Cannot remove controller/);
    });

    it('NEGATIVE INVARIANT — never writes or deletes routing.json', function () {
        // remove.js only ever deletes the controller file + its template tree via
        // fs.rmSync; it creates/writes NO files (no createFileFromDataSync, no
        // fs.writeFileSync/appendFileSync) and never rm's a routing path. The only
        // fs.writeSync calls are to fd 1/2 (stdout/stderr), not a file.
        assert.doesNotMatch(RM_ACTIVE, /createFileFromDataSync/);
        assert.doesNotMatch(RM_ACTIVE, /fs\.(write|append)FileSync/);
        assert.doesNotMatch(RM_ACTIVE, /fs\.rmSync\([^)]*routing/i);
        // the only rmSync targets are the controller file + its template tree
        assert.match(RM_ACTIVE, /fs\.rmSync\(\s*scan\.controllerPath/);
        assert.match(RM_ACTIVE, /fs\.rmSync\(\s*scan\.templatePath/);
        // routing.json is referenced only as the reference-scan target + the "never edited" wording
        assert.match(RM_SRC, /routing\.json is never edited/);
    });

    it('excludes a self-reference (a require in the controller file) from the blockers', function () {
        assert.match(RM_ACTIVE, /r\.file !== scan\.controllerFile/);
    });

    it('surfaces dynamic references as an advisory note (never silently cleared)', function () {
        assert.match(RM_ACTIVE, /dynamicNote\(/);
        assert.match(RM_SRC, /a static scan cannot resolve/);
    });
});


// ---------------------------------------------------------------------------
// 07 — flags: dry-run / force / json
// ---------------------------------------------------------------------------
describe('07 - flags', function () {

    it('--dry-run short-circuits to a preview before any delete', function () {
        assert.match(RM_ACTIVE, /if \(\s*dryRun\s*\)\s*\{\s*\n\s*return reportDryRun\(/);
    });

    it('--force deletes even with blockers and prints what remains', function () {
        assert.match(RM_ACTIVE, /if \(\s*force\s*\)\s*\{\s*\n\s*return reportForce\(/);
        assert.match(RM_SRC, /NOT touched \(routing\.json is never edited\)/);
    });

    it('--format=json emits the envelope and only deletes with --force', function () {
        assert.match(RM_ACTIVE, /jsonMode = \/\^json\?\/\.test/);
        assert.match(RM_ACTIVE, /!dryRun && force/);
        assert.match(RM_ACTIVE, /fs\.writeSync\(\s*1\s*,\s*JSON\.stringify/);
        assert.match(RM_ACTIVE, /removable\s*:\s*b\.count === 0/);
    });

    it('prints reports via flush-safe fs.writeSync(1, ...)', function () {
        assert.match(RM_ACTIVE, /fs\.writeSync\(\s*1\s*,\s*lines\.join/);
    });
});


// ---------------------------------------------------------------------------
// 08 — confirm idiom (readline, non-TTY guard)
// ---------------------------------------------------------------------------
describe('08 - confirm idiom', function () {

    it('creates a module-scope readline interface', function () {
        assert.match(RM_SRC, /readline\.createInterface\(process\.stdin, process\.stdout\)/);
    });

    it('guards against a non-TTY stdin, naming the --force / --dry-run bypass', function () {
        assert.match(RM_ACTIVE, /!process\.stdin\.isTTY \|\| rl\.closed/);
        assert.match(RM_SRC, /pass --force to delete non-interactively, or --dry-run to preview/);
    });

    it('prompts yes/no and only deletes on confirmation', function () {
        assert.match(RM_ACTIVE, /rl\.setPrompt\(/);
        assert.match(RM_ACTIVE, /case 'yes':/);
        assert.match(RM_ACTIVE, /case 'no':/);
    });

    it('counts template files BEFORE deleting them (report is not zeroed by the delete)', function () {
        // in both destructive paths, deletionLines(...) is computed before performDelete(scan)
        // ([^\n]* tolerates the inline // comment that survives comment-stripping)
        assert.match(RM_ACTIVE, /var deleted = deletionLines\(scan, 'deleted'\);[^\n]*\n\s*performDelete\(scan\)/);
        assert.match(RM_ACTIVE, /done = done\.concat\(deletionLines\(scan, 'deleted'\)\);[^\n]*\n\s*performDelete\(scan\)/);
    });
});


// ---------------------------------------------------------------------------
// 09 — registration + help + arguments + rm alias
// ---------------------------------------------------------------------------
describe('09 - registration + help + alias', function () {

    it('arguments.json whitelists --dry-run / --force / --format', function () {
        ['--dry-run', '--force', '--format'].forEach(function (f) {
            assert.ok(ARGS_ARR.indexOf(f) > -1, f);
        });
    });

    it('help.txt documents controller:remove and the rm alias with samples', function () {
        assert.match(HELP_TXT, /gina controller:remove <name> <bundle> @<project>/);
        assert.match(HELP_TXT, /controller:rm checkout demo @myproject/);
        assert.match(HELP_TXT, /--dry-run/);
        assert.match(HELP_TXT, /--force/);
    });

    it('rm.js is a thin re-export of ./remove', function () {
        assert.match(RMALIAS, /module\.exports\s*=\s*require\('\.\/remove'\)/);
    });
});
