var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs     = require('fs');
var path   = require('path');

var CLI_SOURCE = path.resolve(__dirname, '../../bin/cli');


// ---------------------------------------------------------------------------
// 01 — Source: def_framework sync block is present in bin/cli
// ---------------------------------------------------------------------------
describe('01 - bin/cli: def_framework sync block', function() {

    it('def_framework sync block is present in source', function() {
        var src = fs.readFileSync(CLI_SOURCE, 'utf8');
        assert.ok(
            /def_framework/.test(src),
            'expected def_framework sync block in bin/cli'
        );
    });

    it('sync is gated on bundle|project start|restart commands', function() {
        var src = fs.readFileSync(CLI_SOURCE, 'utf8');
        assert.ok(
            /\(bundle\|project\):\(start\|restart\)/.test(src),
            'expected sync to be gated on bundle|project start|restart in bin/cli'
        );
    });

    it('compares _mainData.def_framework !== version before updating', function() {
        var src = fs.readFileSync(CLI_SOURCE, 'utf8');
        assert.ok(
            /_mainData\.def_framework\s*!==\s*version/.test(src),
            'expected `_mainData.def_framework !== version` guard in bin/cli'
        );
    });

    it('reads main.json from the gina home directory', function() {
        var src = fs.readFileSync(CLI_SOURCE, 'utf8');
        assert.ok(
            /main\.json/.test(src),
            'expected main.json path in bin/cli def_framework sync'
        );
    });

    it('updates frameworks[shortVersion] array when syncing', function() {
        var src = fs.readFileSync(CLI_SOURCE, 'utf8');
        assert.ok(
            /frameworks\[shortVersion\]/.test(src),
            'expected frameworks[shortVersion] update in bin/cli'
        );
    });

    it('uses lib.generator.createFileFromDataSync to write main.json', function() {
        var src = fs.readFileSync(CLI_SOURCE, 'utf8');
        assert.ok(
            /generator\.createFileFromDataSync\(_mainData/.test(src),
            'expected generator.createFileFromDataSync(_mainData...) in bin/cli — use the canonical write API'
        );
    });

    it('emits a stdout warning on sync error', function() {
        var src = fs.readFileSync(CLI_SOURCE, 'utf8');
        assert.ok(
            /could not sync def_framework/.test(src),
            'expected "could not sync def_framework" warning in bin/cli'
        );
    });

});


// ---------------------------------------------------------------------------
// 02 — bin/cli file exists and has a node shebang
// ---------------------------------------------------------------------------
describe('02 - bin/cli: file exists and is valid', function() {

    it('bin/cli file exists', function() {
        assert.ok(
            fs.existsSync(CLI_SOURCE),
            'expected bin/cli to exist'
        );
    });

    it('bin/cli has a node shebang', function() {
        var src = fs.readFileSync(CLI_SOURCE, 'utf8');
        assert.ok(
            /^#!\/usr\/bin\/env node/.test(src),
            'expected #!/usr/bin/env node shebang on first line'
        );
    });

    it('bin/cli is referenced by bin/gina (the public entry point)', function() {
        var ginaSrc = fs.readFileSync(path.resolve(__dirname, '../../bin/gina'), 'utf8');
        assert.ok(
            /bin\/cli/.test(ginaSrc) || /require.*cli/.test(ginaSrc),
            'expected bin/gina to reference bin/cli'
        );
    });

});


// ---------------------------------------------------------------------------
// 03 — Source: framework-dir existence guard runs BEFORE requiring from it
//
// GINA_VERSION (env/state) can resolve to a version whose framework dir is not
// installed (stale pin, or a bind-mounted dev tree at a different version).
// The require(frameworkPath + '/lib/generator') must be guarded by an
// fs.existsSync(frameworkPath) check that runs FIRST — otherwise the require
// throws an opaque MODULE_NOT_FOUND that the catch mislabels as "could not
// load package.json", and every CLI command silently fails.
// ---------------------------------------------------------------------------
describe('03 - bin/cli: framework version existence guard precedes the require', function() {

    it('guards on !fs.existsSync(frameworkPath) before requiring lib/generator', function() {
        var src        = fs.readFileSync(CLI_SOURCE, 'utf8');
        var guardIdx   = src.indexOf('!fs.existsSync(frameworkPath)');
        var requireIdx = src.indexOf("require(frameworkPath + '/lib/generator')");
        assert.ok(guardIdx > -1, 'expected an !fs.existsSync(frameworkPath) guard');
        assert.ok(requireIdx > -1, "expected require(frameworkPath + '/lib/generator')");
        assert.ok(
            guardIdx < requireIdx,
            'expected the framework-dir existence guard to run BEFORE require(.../lib/generator)'
        );
    });

    it('the early guard points the user at `gina framework:add <version>`', function() {
        var src      = fs.readFileSync(CLI_SOURCE, 'utf8');
        var guardIdx = src.indexOf('!fs.existsSync(frameworkPath)');
        var window   = src.slice(guardIdx, guardIdx + 500);
        assert.ok(/framework:add/.test(window), 'expected framework:add hint in the early guard');
    });

    it('the early guard fails fast via process.exit(1)', function() {
        var src      = fs.readFileSync(CLI_SOURCE, 'utf8');
        var guardIdx = src.indexOf('!fs.existsSync(frameworkPath)');
        var window   = src.slice(guardIdx, guardIdx + 500);
        assert.ok(/process\.exit\(1\)/.test(window), 'expected the early guard to exit non-zero');
    });

    it('uses process.stderr.write (logger is not loaded yet at this point)', function() {
        var src      = fs.readFileSync(CLI_SOURCE, 'utf8');
        var guardIdx = src.indexOf('!fs.existsSync(frameworkPath)');
        var window   = src.slice(guardIdx, guardIdx + 500);
        assert.ok(
            /process\.stderr\.write/.test(window),
            'expected process.stderr.write (console.alert is undefined before lib loads)'
        );
    });
});


// ---------------------------------------------------------------------------
// 04 — Source + logic: framework-connection params (--port, --mq-port,
//      --host-v4, --hostname, --debug-port) are hoisted into GINA_* / persisted
//      to settings.json ONLY for framework-scoped commands (#B40).
//
// Regression: `gina port:set <bundle> --port=N` (a sub-topic command whose
// `--port` is the BUNDLE port) used to hoist N into GINA_PORT and persist it as
// the FRAMEWORK socket port in ~/.gina/<short>/settings.json (8124 -> N), so
// every later online command connected to the wrong port and reported
// "[ gina ] not started". The hoist is now gated on isFrameworkScopedCmd; the
// --inspect/--debug splice stays unconditional (bundle:start --inspect needs it).
// ---------------------------------------------------------------------------
describe('04 - bin/cli: framework-connection param hoist scoped to framework commands (#B40)', function() {

    var src = fs.readFileSync(CLI_SOURCE, 'utf8');

    it('defines an isFrameworkScopedCmd predicate', function() {
        assert.ok(src.indexOf('var isFrameworkScopedCmd') > -1,
            'expected an isFrameworkScopedCmd predicate in bin/cli');
    });

    it('the predicate is (_topic has no ":" || starts with framework:)', function() {
        assert.ok(
            src.indexOf("_topic.indexOf(':') < 0 || /^framework:/.test(_topic)") > -1,
            'expected isFrameworkScopedCmd = (_topic.indexOf(":") < 0 || /^framework:/.test(_topic))'
        );
    });

    it('gates all five framework-connection param branches on isFrameworkScopedCmd', function() {
        [
            'isFrameworkScopedCmd && /^\\-\\-port/',
            'isFrameworkScopedCmd && /^\\-\\-mq\\-port/',
            'isFrameworkScopedCmd && /^\\-\\-host\\-v4/',
            'isFrameworkScopedCmd && /^\\-\\-hostname/',
            'isFrameworkScopedCmd && /^\\-\\-debug(\\_|\\-)port/'
        ].forEach(function(needle) {
            assert.ok(src.indexOf(needle) > -1, 'expected gated branch: ' + needle);
        });
    });

    it('does NOT gate the --inspect/--debug splice', function() {
        assert.ok(
            src.indexOf('if ( /^\\-\\-(inspect|debug)/.test(params[p])') > -1,
            'expected the --inspect/--debug branch to remain unconditional'
        );
        assert.equal(
            src.indexOf('isFrameworkScopedCmd && /^\\-\\-(inspect'), -1,
            'the --inspect/--debug splice must NOT be gated on isFrameworkScopedCmd'
        );
    });

    // ---- pure-logic replica of the predicate ----
    function isFrameworkScopedCmd(topic) {
        var _topic = topic || '';
        return ( _topic.indexOf(':') < 0 || /^framework:/.test(_topic) );
    }

    it('predicate: bare commands (start/stop/restart/status/tail) and empty are framework-scoped', function() {
        ['start', 'stop', 'restart', 'status', 'tail', ''].forEach(function(c) {
            assert.equal(isFrameworkScopedCmd(c), true, c + ' should be framework-scoped');
        });
    });

    it('predicate: framework:* commands are framework-scoped', function() {
        ['framework:set', 'framework:start', 'framework:restart'].forEach(function(c) {
            assert.equal(isFrameworkScopedCmd(c), true, c + ' should be framework-scoped');
        });
    });

    it('predicate: sub-topic commands are NOT framework-scoped', function() {
        ['port:set', 'port:reset', 'bundle:start', 'bundle:add', 'project:start', 'connector:list'].forEach(function(c) {
            assert.equal(isFrameworkScopedCmd(c), false, c + ' should NOT be framework-scoped');
        });
    });

    // ---- behavioural replica: mirrors the gated hoist + bin/cli:306 fallback ----
    // settings['port'] = getEnvVar('GINA_PORT') || settings['port']
    function resolvedFrameworkPort(topic, argv, settingsPort) {
        var scoped = isFrameworkScopedCmd(topic);
        var ginaPort = null;
        argv.forEach(function(a) {
            if (scoped && /^\-\-port/.test(a)) { ginaPort = ~~(a.split('=')[1]); }
        });
        return ginaPort || settingsPort;
    }

    it('port:set --port=3200 does NOT corrupt the framework socket port (stays 8124)', function() {
        assert.equal(resolvedFrameworkPort('port:set', ['frontend', '@myproject', '--port=3200'], '8124'), '8124');
    });

    it('start --port=9000 DOES set the framework socket port', function() {
        assert.equal(resolvedFrameworkPort('start', ['--port=9000'], '8124'), 9000);
    });

    it('bundle:start --inspect=9229 does NOT touch the framework socket port', function() {
        assert.equal(resolvedFrameworkPort('bundle:start', ['frontend', '@myproject', '--inspect=9229'], '8124'), '8124');
    });
});
