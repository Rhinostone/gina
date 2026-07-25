/**
 * lib/cmd/controller/add.js + its pure inc/ helpers — `controller:add` scaffolder.
 *
 * The inc/ helpers (namespace, scaffold, args) are dependency-free
 * (no fs, no framework globals), so they are exercised BEHAVIORALLY by
 * require-by-path — driving the real functions and asserting their returned
 * values (the strong coverage: the generated controller source, the routing
 * rules, the parsed controls, the positional parse). add.js itself runs inside
 * the CLI daemon context (CmdHelper + gina-injected globals), which is heavy to
 * replicate for near-zero extra coverage, so it is covered by source-inspection
 * pins of its structural invariants — chiefly the negative "never writes
 * routing.json" (the print-only contract) whose behavioral proof lives in the
 * isolated-home smoke.
 */

'use strict';

var fs     = require('fs');
var path   = require('path');
var vm     = require('vm');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var FW = require('../fw');

// pure helpers — loaded directly (no framework globals)
var ns       = require(path.join(FW, 'lib/cmd/controller/inc/namespace'));
var scaffold = require(path.join(FW, 'lib/cmd/controller/inc/scaffold'));
var args     = require(path.join(FW, 'lib/cmd/controller/inc/args'));

// handler + config — read as source
var ADD_SRC  = fs.readFileSync(path.join(FW, 'lib/cmd/controller/add.js'), 'utf8');
var HELP_TXT = fs.readFileSync(path.join(FW, 'lib/cmd/controller/help.txt'), 'utf8');
var ARGS_ARR = JSON.parse(fs.readFileSync(path.join(FW, 'lib/cmd/controller/arguments.json'), 'utf8'));
var CLI_SRC  = fs.readFileSync(path.join(__dirname, '..', '..', 'bin', 'cli'), 'utf8');

// comment-stripped handler source for negative code-absence pins (so a pin never
// trips on the module's own JSDoc, per the pin discipline)
var ADD_ACTIVE = ADD_SRC.split('\n').filter(function (l) {
    return !/^\s*(\/\/|\*|\/\*)/.test(l);
}).join('\n');


// ---------------------------------------------------------------------------
// 01 — namespace helper (behavioral)
// ---------------------------------------------------------------------------
describe('01 - inc/namespace', function () {

    it('accepts conservative namespaces', function () {
        ['checkout', 'user_profile', 'a', 'valid1', 'x_y_z'].forEach(function (n) {
            assert.equal(ns.isValidNamespace(n), true, n);
        });
    });

    it('rejects the reserved default-controller name (case-insensitive)', function () {
        assert.equal(ns.isValidNamespace('controller'), false);
        assert.equal(ns.isValidNamespace('Controller'), false);
        assert.equal(ns.isValidNamespace('CONTROLLER'), false);
    });

    it('rejects empty, leading-digit, dot, slash, hyphen', function () {
        ['', '1st', 'a.b', 'a/b', 'a-b', '../etc', 'a b'].forEach(function (n) {
            assert.equal(ns.isValidNamespace(n), false, JSON.stringify(n));
        });
    });

    it('rejects non-string namespaces', function () {
        [undefined, null, 5, {}, []].forEach(function (n) {
            assert.equal(ns.isValidNamespace(n), false, String(n));
        });
    });

    it('isValidAction shares the charset but not the reserved list', function () {
        assert.equal(ns.isValidAction('confirm'), true);
        assert.equal(ns.isValidAction('controller'), true); // action `controller` is a harmless method name
        assert.equal(ns.isValidAction('1st'), false);
        assert.equal(ns.isValidAction('a-b'), false);
    });

    it('capitalize / controllerFileName / className', function () {
        assert.equal(ns.capitalize('checkout'), 'Checkout');
        assert.equal(ns.controllerFileName('checkout'), 'controller.checkout.js');
        assert.equal(ns.className('demo', 'checkout'), 'DemoCheckoutController');
        assert.equal(ns.className('web', 'user_profile'), 'WebUser_profileController');
    });

    it('RESERVED contains controller', function () {
        assert.ok(ns.RESERVED.indexOf('controller') > -1);
    });
});


// ---------------------------------------------------------------------------
// 02 — inc/args.positionals (behavioral)
// ---------------------------------------------------------------------------
describe('02 - inc/args.positionals', function () {

    it('extracts 2 positionals (add / remove shape), dropping @project + flags', function () {
        assert.deepEqual(
            args.positionals(['node', 'gina', 'controller:add', 'checkout', 'web', '@app', '--controls=a,b']),
            ['checkout', 'web']
        );
    });

    it('extracts 3 positionals (rename shape)', function () {
        assert.deepEqual(
            args.positionals(['node', 'gina', 'controller:rename', 'old', 'new', 'web', '@app', '--dry-run']),
            ['old', 'new', 'web']
        );
    });

    it('drops @project regardless of position', function () {
        assert.deepEqual(
            args.positionals(['node', 'gina', 'controller:add', 'checkout', '@app', 'web']),
            ['checkout', 'web']
        );
    });

    it('is empty when only the command is present', function () {
        assert.deepEqual(args.positionals(['node', 'gina', 'controller:add']), []);
    });

    it('tolerates undefined / missing argv', function () {
        assert.deepEqual(args.positionals(undefined), []);
        assert.deepEqual(args.positionals([]), []);
    });
});


// ---------------------------------------------------------------------------
// 03 — inc/scaffold.parseControls (behavioral)
// ---------------------------------------------------------------------------
describe('03 - scaffold.parseControls', function () {

    it('parses a comma list', function () {
        var r = scaffold.parseControls('start,confirm,cancel');
        assert.deepEqual(r.actions, ['start', 'confirm', 'cancel']);
        assert.deepEqual(r.invalid, []);
        assert.equal(r.defaulted, false);
    });

    it('omitted (undefined) -> single default action', function () {
        var r = scaffold.parseControls(undefined);
        assert.deepEqual(r.actions, ['default']);
        assert.equal(r.defaulted, true);
        assert.equal(scaffold.DEFAULT_ACTION, 'default');
    });

    it('bare --controls (boolean true) -> default action', function () {
        assert.deepEqual(scaffold.parseControls(true).actions, ['default']);
    });

    it('tolerates trailing / doubled commas', function () {
        assert.deepEqual(scaffold.parseControls('a,,b,').actions, ['a', 'b']);
    });

    it('de-dupes, first occurrence wins', function () {
        assert.deepEqual(scaffold.parseControls('a,b,a').actions, ['a', 'b']);
    });

    it('collects invalid tokens without stopping', function () {
        var r = scaffold.parseControls('ok,1bad,x-y');
        assert.deepEqual(r.actions, ['ok']);
        assert.deepEqual(r.invalid, ['1bad', 'x-y']);
    });
});


// ---------------------------------------------------------------------------
// 04 — inc/scaffold.buildRules (behavioral)
// ---------------------------------------------------------------------------
describe('04 - scaffold.buildRules', function () {

    it('view flavor carries an explicit param.file (= action)', function () {
        var r = scaffold.buildRules('checkout', ['start'], 'view')[0];
        assert.equal(r.name, 'checkout-start');
        assert.equal(r.url, '/checkout/start');
        assert.equal(r.method, 'GET');
        assert.equal(r.namespace, 'checkout');
        assert.equal(r.control, 'start');
        assert.equal(r.file, 'start');
    });

    it('api flavor omits param.file (renderJSON, no template)', function () {
        var r = scaffold.buildRules('checkout', ['start'], 'api')[0];
        assert.equal(r.file, null);
    });

    it('the default action routes to the namespace ROOT', function () {
        var r = scaffold.buildRules('checkout', ['default'], 'view')[0];
        assert.equal(r.name, 'checkout-default');
        assert.equal(r.url, '/checkout');
    });
});


// ---------------------------------------------------------------------------
// 05 — inc/scaffold.formatRulesBlock (behavioral)
// ---------------------------------------------------------------------------
describe('05 - scaffold.formatRulesBlock', function () {

    it('view block: one entry per action, file key present, comma-separated, no trailing comma', function () {
        var block = scaffold.formatRulesBlock(scaffold.buildRules('checkout', ['start', 'confirm'], 'view'));
        assert.match(block, /"checkout-start": \{/);
        assert.match(block, /"param": \{ "control": "start", "file": "start" \}/);
        assert.match(block, /\},\n  "checkout-confirm": \{/); // comma between rules
        assert.ok(!/\}\s*,\s*$/.test(block), 'no trailing comma on the last rule');
    });

    it('api block omits the file key', function () {
        var block = scaffold.formatRulesBlock(scaffold.buildRules('account', ['default'], 'api'));
        assert.match(block, /"param": \{ "control": "default" \}/);
        assert.ok(block.indexOf('"file"') < 0, 'api rule has no file key');
    });
});


// ---------------------------------------------------------------------------
// 06 — inc/scaffold.renderController (behavioral: value + it parses)
// ---------------------------------------------------------------------------
describe('06 - scaffold.renderController', function () {

    it('view flavor: render() stubs, class name, one method per action, exports', function () {
        var src = scaffold.renderController('demo', 'checkout', ['start', 'confirm'], 'view');
        assert.match(src, /function DemoCheckoutController\(\)/);
        assert.match(src, /this\.start = function\(req, res\)/);
        assert.match(src, /this\.confirm = function\(req, res\)/);
        assert.match(src, /self\.render\(data\)/);
        assert.ok(src.indexOf('renderJSON') < 0, 'view flavor must not renderJSON');
        assert.match(src, /module\.exports = DemoCheckoutController/);
        assert.doesNotThrow(function () { new vm.Script(src); }, 'generated controller must parse');
    });

    it('api flavor: renderJSON stubs, no render(data)', function () {
        var src = scaffold.renderController('demo', 'webhooks', ['ping'], 'api');
        assert.match(src, /function DemoWebhooksController\(\)/);
        assert.match(src, /self\.renderJSON\(/);
        assert.ok(src.indexOf('self.render(data)') < 0, 'api flavor must not render(data)');
        assert.doesNotThrow(function () { new vm.Script(src); });
    });

    it('exactly one action method per control', function () {
        var src = scaffold.renderController('demo', 'orders', ['a', 'b', 'c'], 'api');
        assert.equal((src.match(/this\.\w+ = function\(req, res\)/g) || []).length, 3);
    });
});


// ---------------------------------------------------------------------------
// 07 — inc/scaffold.renderTemplate (behavioral)
// ---------------------------------------------------------------------------
describe('07 - scaffold.renderTemplate', function () {

    it('extends the bundle layout and renders the title', function () {
        var t = scaffold.renderTemplate('checkout', 'start');
        assert.match(t, /\{% extends 'layouts\/main\.html' %\}/);
        assert.match(t, /\{% block content %\}/);
        assert.match(t, /\{\{ data\.title \}\}/);
        assert.match(t, /<code>checkout<\/code>/);
        assert.match(t, /<code>start<\/code>/);
    });
});


// ---------------------------------------------------------------------------
// 08 — add.js handler structural invariants (source pins)
// ---------------------------------------------------------------------------
describe('08 - add.js structure', function () {

    it('exports the Add constructor', function () {
        assert.match(ADD_SRC, /module\.exports\s*=\s*Add/);
        assert.match(ADD_SRC, /function Add\(opt, cmd\)/);
    });

    it('reads positionals via the group parser, not the contaminated self.bundles', function () {
        assert.match(ADD_ACTIVE, /args\.positionals\(\s*opt\.argv\s*\)/);
    });

    it('validates the namespace charset BEFORE building any path', function () {
        // pIdx anchors on the first interpolation of the namespace into a path
        // segment (ns.controllerFileName), NOT the bare 'controllers/' which also
        // appears earlier in buildReport's report string.
        var vIdx = ADD_ACTIVE.indexOf('ns.isValidNamespace(');
        var pIdx = ADD_ACTIVE.indexOf('ns.controllerFileName(');
        assert.ok(vIdx > -1, 'calls ns.isValidNamespace');
        assert.ok(pIdx > -1, 'builds the controller file name from the namespace');
        assert.ok(vIdx < pIdx, 'namespace validated before it becomes a path segment');
    });

    it('refuses an existing controller file', function () {
        assert.match(ADD_ACTIVE, /fs\.existsSync\(\s*controllerPath\s*\)/);
        assert.match(ADD_SRC, /already exists/);
    });

    it('auto-detects the flavor via config/templates.json', function () {
        assert.match(ADD_ACTIVE, /config\/templates\.json/);
        assert.match(ADD_ACTIVE, /'view'|'api'/);
    });

    it('honors the --api / --views override and rejects passing both', function () {
        assert.match(ADD_ACTIVE, /p\['api'\]/);
        assert.match(ADD_ACTIVE, /p\['views'\]/);
        assert.match(ADD_SRC, /only one of --api \/ --views/);
    });

    it('prints via flush-safe fs.writeSync(1, ...) (paste-ready + no pipe truncation)', function () {
        assert.match(ADD_ACTIVE, /fs\.writeSync\(\s*1\s*,\s*report\s*\)/);
    });

    it('NEGATIVE INVARIANT — never writes routing.json (print-only contract)', function () {
        // no createFileFromDataSync / fs write call ever targets a routing path
        assert.doesNotMatch(ADD_ACTIVE, /createFileFromDataSync\s*\([^)]*routing/i);
        assert.doesNotMatch(ADD_ACTIVE, /fs\.write[^(]*\([^)]*routing/i);
        // routing.json is referenced ONLY as the print target in the report
        assert.match(ADD_ACTIVE, /config\/routing\.json/);
    });
});


// ---------------------------------------------------------------------------
// 09 — registration + help + arguments
// ---------------------------------------------------------------------------
describe('09 - registration', function () {

    it("bin/cli allowedOffline includes 'controller:'", function () {
        assert.match(CLI_SRC, /'controller:'/);
    });

    it('arguments.json whitelists --controls / --api / --views', function () {
        ['--controls', '--api', '--views'].forEach(function (f) {
            assert.ok(ARGS_ARR.indexOf(f) > -1, f);
        });
    });

    it('help.txt shows the add samples', function () {
        assert.match(HELP_TXT, /gina controller:add <name> <bundle> @<project>/);
        assert.match(HELP_TXT, /--controls=start,confirm,cancel/);
        assert.match(HELP_TXT, /--api/);
        assert.match(HELP_TXT, /--views/);
    });
});
