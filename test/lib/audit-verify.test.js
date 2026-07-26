'use strict';
/**
 * gina audit:verify — the offline chain-verification CLI (#COMPLY2 slice 3).
 *
 * Strategy (the controller-group precedent): the chain ENGINE
 * (`lib.audit.verifyChain`) is covered behaviorally in
 * `test/lib/audit-chain.test.js`; the handler needs the CmdHelper +
 * gina-injected-globals daemon context, so IT is covered by
 * source-inspection pins — registration (allowedOffline / arguments.json /
 * help.txt / gina.1.md), the resolution contracts (env validated manually,
 * requireJSON for commented settings, the boot's default-path replay), and
 * the output discipline (fs.writeSync flush before exit — the pipe
 * truncation rule; exit codes 0/1/2).
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

var VERIFY_SRC = fs.readFileSync(path.join(FW, 'lib/cmd/audit/verify.js'), 'utf8');
var HELP_TXT   = fs.readFileSync(path.join(FW, 'lib/cmd/audit/help.txt'), 'utf8');
var ARGS_ARR   = JSON.parse(fs.readFileSync(path.join(FW, 'lib/cmd/audit/arguments.json'), 'utf8'));
var CLI_SRC    = fs.readFileSync(path.join(__dirname, '..', '..', 'bin', 'cli'), 'utf8');
var MAN_MD     = fs.readFileSync(path.join(FW, 'lib/cmd/gina.1.md'), 'utf8');

/** Comment-stripped source — negative pins must not trip on prose. */
var VERIFY_ACTIVE = VERIFY_SRC.split('\n').filter(function (l) {
    return !/^\s*(\/\/|\*|\/\*)/.test(l);
}).join('\n');

describe('audit:verify §01 — group registration', function () {

    it("bin/cli allowedOffline includes 'audit:' — without it the verb hard-exits before dispatch", function () {
        assert.match(CLI_SRC, /'audit:'/);
    });

    it('every documented flag is whitelisted in arguments.json', function () {
        ['--env', '--file', '--format'].forEach(function (flag) {
            assert.ok(ARGS_ARR.indexOf(flag) > -1, flag + ' must be whitelisted or it is swallowed into nodeParams');
        });
    });

    it('help.txt shows the usage samples, the exit codes, and the honest boundary statement', function () {
        assert.match(HELP_TXT, /audit:verify <bundle> @<project>/);
        assert.match(HELP_TXT, /gina audit:verify web @myproject/);
        assert.match(HELP_TXT, /--format=json/);
        assert.match(HELP_TXT, /chain BROKEN/);
        assert.match(HELP_TXT, /truncation at the exact\s+tail/, 'the boundary must be in the operator-facing help, not only in docs');
    });

    it('gina.1.md lists the audit group in ASSETICS', function () {
        var assetics = MAN_MD.slice(MAN_MD.indexOf('## ASSETICS'), MAN_MD.indexOf('## ENVIRONMENT'));
        assert.match(assetics, /^audit$/m);
    });
});

describe('audit:verify §02 — the handler contracts (source pins)', function () {

    it('wires CmdHelper first — the house offline-handler idiom', function () {
        assert.match(VERIFY_ACTIVE, /new CmdHelper\(self, opt\.client/);
        assert.match(VERIFY_ACTIVE, /if \(!isCmdConfigured\(\)\) return false;/);
    });

    it('validates --env against self.envs itself — the CmdHelper override only fires for lifecycle tasks', function () {
        assert.match(VERIFY_ACTIVE, /self\.envs\.indexOf\(p\.env\) < 0/);
        assert.match(VERIFY_ACTIVE, /self\.projects\[self\.projectName\]\.def_env/);
    });

    it('reads settings.json through requireJSON, never JSON.parse — settings files carry // comments', function () {
        assert.match(VERIFY_ACTIVE, /requireJSON\(settingsPath\)/);
        assert.doesNotMatch(VERIFY_ACTIVE, /JSON\.parse\(fs\.readFileSync\([^)]*settings/);
    });

    it("replays the boot's default-path derivation: <project>/logs/audit-<bundle>-<env>.jsonl", function () {
        assert.match(VERIFY_ACTIVE, /\/logs\/audit-'\+ local\.bundle \+'-'\+ local\.env \+'\.jsonl'/);
    });

    it('calls the chain engine through the lib registry — the bare-module form does not resolve in cmd scope', function () {
        assert.match(VERIFY_ACTIVE, /lib\.audit\.verifyChain\(/);
        assert.doesNotMatch(VERIFY_ACTIVE, /require\('lib\/audit'\)/);
    });

    it('flushes the report with fs.writeSync before exiting — process.exit truncates async stdout on a pipe', function () {
        var writeIdx = VERIFY_ACTIVE.indexOf('fs.writeSync(1, out)');
        assert.ok(writeIdx > -1, 'the synchronous flush');
        var endIdx = VERIFY_ACTIVE.indexOf('end(result.ok ? 0 : 1)', writeIdx);
        assert.ok(endIdx > writeIdx, 'flush first, exit second');
    });

    it('a missing trail is exit 2 with an explicit not-a-pass message — never a silent green', function () {
        assert.match(VERIFY_ACTIVE, /A missing trail is NOT a pass/);
    });

    it('the secret chain: settings > audit.chain.secret (with ${secret:VAR} shell resolution) then GINA_AUDIT_SECRET via the framework env reader', function () {
        assert.ok(VERIFY_ACTIVE.indexOf('secret.match(/^\\$\\{secret:([^}]+)\\}$/)') > -1,
            'the ${secret:VAR} placeholder-resolution regex — config-load substitution does not run offline');
        assert.match(VERIFY_ACTIVE, /getEnvVar\('GINA_AUDIT_SECRET'\)/);
        assert.match(VERIFY_ACTIVE, /process\.env\.GINA_AUDIT_SECRET/);
    });
});
