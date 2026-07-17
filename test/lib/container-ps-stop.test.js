/**
 * lib/cmd/container/ps.js + lib/cmd/container/stop.js — the `container:ps` and
 * `container:stop` verbs, the new `container:` command group, and the
 * parseInspectState primitive they introduce.
 *
 * `container:*` is a group of its own because these verbs act on CONTAINERS,
 * not images — the same split podman and docker make. Both are HOST-level: they
 * resolve the container host through the SAME precedence as `image:build`, and
 * neither takes a project. Both drive podman, since buildah cannot run
 * containers, so both must report a build-only host honestly.
 *
 * Behavioural tests drive the REAL pure lib (required by path — it reads no
 * framework globals); the CLI handlers (which need the CmdHelper daemon
 * context) are covered by source-inspection pins, matching image-list-rm.test.js
 * and image-run-family.test.js. Coverage:
 *
 *   (a) parseInspectState — the rung source: podman exits 0 either way, so the
 *       container's own exit code is the only discriminator
 *   (b) rung classification — 137 (SIGKILL after the grace period) vs a
 *       container that handled the signal, vs --force
 *   (c) handler pins — podman (not buildah), the full inspect document, the
 *       ps/stop argv, fs.writeSync, and the ordering invariant
 *   (d) group registration — allowedOffline is an EXACT-match membership test,
 *       so a missing `container:` entry would hard-exit before any handler loads
 *   (e) CmdHelper exemption — anchored, and it must not leak to project:*
 *   (f) arguments.json — an unlisted flag is silently routed to nodeParams
 *   (g) help.txt + the group shims
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var FW           = require('../fw');
var ROOT         = path.join(FW, '../..');
var LIB_MAIN     = path.join(FW, 'lib/image-build/src/main.js');
var PS_HANDLER   = path.join(FW, 'lib/cmd/container/ps.js');
var STOP_HANDLER = path.join(FW, 'lib/cmd/container/stop.js');
var HOST_UTIL    = path.join(FW, 'lib/cmd/image/_host.js');
var HELP_TXT     = path.join(FW, 'lib/cmd/container/help.txt');
var ARGS_FILE    = path.join(FW, 'lib/cmd/container/arguments.json');
var CMD_HELPER   = path.join(FW, 'lib/cmd/helper.js');
var GINA_MAN     = path.join(FW, 'lib/cmd/gina.1.md');
var CLI_BIN      = path.join(ROOT, 'bin/cli');

var imageBuild = require(LIB_MAIN);

var psSrc     = fs.readFileSync(PS_HANDLER, 'utf8');
var stopSrc   = fs.readFileSync(STOP_HANDLER, 'utf8');
var hostSrc   = fs.readFileSync(HOST_UTIL, 'utf8');
var helpTxt   = fs.readFileSync(HELP_TXT, 'utf8');
var argsArr   = JSON.parse(fs.readFileSync(ARGS_FILE, 'utf8'));
var helperSrc = fs.readFileSync(CMD_HELPER, 'utf8');
var manSrc    = fs.readFileSync(GINA_MAN, 'utf8');
var cliSrc    = fs.readFileSync(CLI_BIN, 'utf8');

// Full-line comments only — see image-run-family.test.js for why the negative
// code-absence pins read a stripped copy rather than the raw source.
var stripComments = function(src) {
    return src.split('\n').filter(function(line) {
        return !/^\s*(\/\/|\*|\/\*)/.test(line);
    }).join('\n');
};
var psCode   = stripComments(psSrc);
var stopCode = stripComments(stopSrc);

describe('container:ps + container:stop — the container group (lib/image-build + lib/cmd/container)', function() {

    // -----------------------------------------------------------------------
    // (a) parseInspectState
    // -----------------------------------------------------------------------
    describe('01 — parseInspectState', function() {

        it('digs the id, name and exit code out of the inspect document', function() {
            var doc = JSON.stringify([
                { Id: '745903c26735aa11bb22cc33dd44ee55ff667788990011223344556677889900', Name: 'demo', State: { Status: 'exited', ExitCode: 143 } }
            ]);
            assert.deepEqual(imageBuild.parseInspectState(doc), { id: '745903c26735', name: 'demo', exitCode: 143 });
        });

        it('strips a leading slash from the name (the docker-style rendering)', function() {
            assert.equal(imageBuild.parseInspectState('[{"Id":"i","Name":"/demo","State":{"ExitCode":0}}]').name, 'demo');
        });

        it('accepts an array Names defensively (the ps document spells it that way)', function() {
            assert.equal(imageBuild.parseInspectState('[{"Id":"i","Names":["demo"],"State":{"ExitCode":0}}]').name, 'demo');
        });

        it('accepts a bare (non-array) inspect object too', function() {
            assert.deepEqual(imageBuild.parseInspectState('{"Id":"abc123def4567","Name":"x","State":{"ExitCode":137}}'),
                { id: 'abc123def456', name: 'x', exitCode: 137 });
        });

        it('exitCode 0 survives (it must not be confused with "unknown")', function() {
            assert.equal(imageBuild.parseInspectState('[{"Id":"i","Name":"n","State":{"ExitCode":0}}]').exitCode, 0);
        });

        it('reports nulls rather than throwing on anything unparseable', function() {
            ['', '   ', 'null', 'not json', '[]', '"str"', undefined, null].forEach(function(input) {
                assert.deepEqual(imageBuild.parseInspectState(input), { id: null, name: null, exitCode: null },
                    'input: ' + JSON.stringify(input));
            });
        });

        it('a missing or non-numeric State.ExitCode is null, not a guess', function() {
            assert.equal(imageBuild.parseInspectState('[{"Id":"i","Name":"n"}]').exitCode, null);
            assert.equal(imageBuild.parseInspectState('[{"Id":"i","Name":"n","State":{}}]').exitCode, null);
            assert.equal(imageBuild.parseInspectState('[{"Id":"i","Name":"n","State":{"ExitCode":"137"}}]').exitCode, null);
        });
    });

    // -----------------------------------------------------------------------
    // (b) the rung — what podman's own exit code hides
    // -----------------------------------------------------------------------
    describe('02 — rung classification', function() {

        // Pure-logic replica of stop.js's classifyRung. podman exits 0 whether
        // the container handled SIGTERM or was SIGKILLed after the grace period,
        // so the container's own exit code is the ONLY discriminator: 137 is
        // 128+SIGKILL (measured on a non-trapping container), while a
        // TERM-trapping one reports its own code (measured: 143).
        var classifyRung = function(forced, exitCode) {
            if (forced) return 'forced';
            return (exitCode === 137) ? 'killed' : 'graceful';
        };

        it('137 means podman escalated to SIGKILL after the grace period', function() {
            assert.equal(classifyRung(false, 137), 'killed');
        });

        it('143 (a TERM-trapping container) is a graceful stop', function() {
            assert.equal(classifyRung(false, 143), 'graceful');
        });

        it('an application exit code is graceful — the container came down on its own terms', function() {
            assert.equal(classifyRung(false, 0), 'graceful');
            assert.equal(classifyRung(false, 1), 'graceful');
        });

        it('--force is always reported as forced, never mislabelled killed', function() {
            assert.equal(classifyRung(true, 137), 'forced');
        });

        it('an unknown exit code (a failed inspect) still reports a rung rather than crashing', function() {
            assert.equal(classifyRung(false, null), 'graceful');
        });
    });

    // -----------------------------------------------------------------------
    // (c) handler pins
    // -----------------------------------------------------------------------
    describe('03 — handler pins', function() {

        it('both consume the lib through the registry (never a bare require)', function() {
            assert.match(psSrc,   /var imageBuild = lib\.imageBuild;/);
            assert.match(stopSrc, /var imageBuild = lib\.imageBuild;/);
            assert.doesNotMatch(psSrc,   /require\(.*image-build/);
            assert.doesNotMatch(stopSrc, /require\(.*image-build/);
        });

        // The container verbs live in their own group but MUST resolve the same
        // host as image:build, or container:ps would list a different machine
        // than image:run ran on.
        it('both resolve the host through the image group`s shared _host preamble', function() {
            [psSrc, stopSrc].forEach(function(src) {
                assert.match(src, /require\('\.\/\.\.\/image\/_host'\)/, 'cross-group require of the shared preamble');
                assert.match(src, /hostUtil\.resolveHost\(\)/);
                assert.doesNotMatch(src, /var resolveHost = function/, 'no inline copy');
                assert.match(src, /host\.mode === 'error'/);
            });
        });

        it('both drive podman, not buildah', function() {
            assert.match(psSrc,   /containerHostSpawn\(host, psArgs, 'podman'\)/);
            assert.match(stopSrc, /containerHostSpawn\(host, stopArgs, 'podman'\)/);
            assert.match(stopSrc, /containerHostSpawn\(host, \['inspect', target\], 'podman'\)/);
        });

        it('ps asks podman for json, and -a only with --all', function() {
            assert.match(psSrc, /all \? \['ps', '-a', '--format', 'json'\] : \['ps', '--format', 'json'\]/);
            assert.match(psSrc, /imageBuild\.parsePsJson\(/);
        });

        it('stop maps --force to `podman kill`, else `podman stop -t <grace>`', function() {
            assert.match(stopSrc, /forced \? \['kill', target\] : \['stop', '-t', String\(grace\), target\]/);
        });

        it('stop defaults the grace period to podman`s own 10s', function() {
            assert.match(stopSrc, /var DEFAULT_GRACE_S = 10;/);
        });

        // The same space-in-token trap as image:run: a `--format '{{...}}'`
        // token cannot cross the ssh path, because ssh hands argv tokens to a
        // remote shell which splits on the space.
        it('stop reads the FULL inspect document — a --format template token would be split by the remote shell', function() {
            assert.match(stopSrc, /\['inspect', target\]/);
            assert.doesNotMatch(stopCode, /\{\{/, 'no go-template token reaches the ssh path');
        });

        it('the comment strippers leave the code intact (an over-stripped source passes every negative pin vacuously)', function() {
            assert.ok(psCode.indexOf("containerHostSpawn(host, psArgs, 'podman')") > -1);
            assert.ok(stopCode.indexOf("containerHostSpawn(host, stopArgs, 'podman')") > -1);
        });

        it('both report a build-only host honestly rather than as an opaque exec failure', function() {
            [psSrc, stopSrc].forEach(function(src) {
                assert.match(src, /hostUtil\.runUnavailableReason\(host, hostLabel, 'container:(ps|stop)'\)/);
                assert.match(src, /hostUtil\.isRunIncapable\(/);
            });
        });

        it('both write stdout with fs.writeSync — a process.exit cannot truncate it on a pipe', function() {
            assert.match(psSrc,   /fs\.writeSync\(1, JSON\.stringify\(\{ host: hostLabel, containers: rows \}\)/);
            assert.match(stopSrc, /fs\.writeSync\(1, JSON\.stringify\(\{/);
            assert.doesNotMatch(psSrc,   /process\.stdout\.write/);
            assert.doesNotMatch(stopSrc, /process\.stdout\.write/);
        });

        it('both validate --format and default to text', function() {
            [psSrc, stopSrc].forEach(function(src) {
                assert.match(src, /\['text', 'json'\]\.indexOf\(self\.format\) < 0/);
                assert.match(src, /var self = \{ format: 'text' \}/);
            });
        });

        // SECURITY-CRITICAL: the container token reaches a remote shell via ssh,
        // so it must be gated before any command is assembled or run.
        it('stop validates the target BEFORE it assembles or runs any command (ordering invariant)', function() {
            var validateIdx = stopSrc.indexOf('isValidContainerToken(target)');
            var assembleIdx = stopSrc.indexOf('var stopArgs =');
            var spawnIdx    = stopSrc.indexOf('containerHostSpawn(host, stopArgs');
            var execIdx     = stopSrc.indexOf('spawnSync(spawnCmd');
            assert.ok(validateIdx > -1, 'stop validates the target');
            assert.ok(assembleIdx > -1 && spawnIdx > -1 && execIdx > -1, 'stop assembles and executes a command');
            assert.ok(validateIdx < assembleIdx, 'validation must precede argv assembly');
            assert.ok(validateIdx < spawnIdx,    'validation must precede spawn-arg assembly');
            assert.ok(validateIdx < execIdx,     'validation must precede execution');
        });

        it('stop gates --time to digits (it is interpolated into the podman argv)', function() {
            assert.match(stopSrc, /\/\^\\d\{1,5\}\$\/\.test\(self\.time\)/);
        });

        it('stop requires an explicit target — no bulk stop', function() {
            assert.match(stopSrc, /requires a container name or id/);
            assert.doesNotMatch(stopCode, /'--all'/, 'no --all bulk stop in this slice');
        });
    });

    // -----------------------------------------------------------------------
    // (d) group registration
    // -----------------------------------------------------------------------
    describe('04 — group registration', function() {

        // allowedOffline membership is an EXACT match on
        // `process.argv[2].split(':')[0] + ':'`, so without this entry
        // container:ps hard-exits before any handler is ever loaded.
        it('bin/cli lists `container:` as offline-allowed (these verbs need no framework socket)', function() {
            assert.match(cliSrc, /var allowedOffline = \[[\s\S]*?'container:',[\s\S]*?\]/);
        });

        it('the man page group list names the container group', function() {
            var assetics = manSrc.substring(manSrc.indexOf('## ASSETICS'), manSrc.indexOf('## ENVIRONMENT'));
            assert.ok(assetics.indexOf('\ncontainer\n') > -1, 'container is listed among the command groups');
        });

        // Dispatch auto-discovers `/cmd/<topic>/<action>.js`, so a new group
        // needs no registration beyond the files themselves — but the group
        // shims must exist or `container:help` / `container:man` break.
        it('the group ships the help + man shims dispatch expects', function() {
            assert.ok(fs.existsSync(path.join(FW, 'lib/cmd/container/help.js')));
            assert.ok(fs.existsSync(path.join(FW, 'lib/cmd/container/man.js')));
            assert.match(fs.readFileSync(path.join(FW, 'lib/cmd/container/man.js'), 'utf8'), /require\('\.\.\/man-render'\)/);
        });
    });

    // -----------------------------------------------------------------------
    // (e) CmdHelper exemption
    // -----------------------------------------------------------------------
    describe('05 — CmdHelper project exemption', function() {

        it('helper.js exempts container:ps and container:stop, anchored', function() {
            assert.match(helperSrc, /!\/\^container\\:\(ps\|stop\)\$\/\.test\(cmd\.task\)/);
        });

        // Pure-logic replica of the helper.js outer gate.
        var needsProject = function(task) {
            return !/\:list$/.test(task)
                && !/^project\:status$/.test(task)
                && !/^image\:rm$/.test(task)
                && !/^image\:run$/.test(task)
                && !/^container\:(ps|stop)$/.test(task);
        };

        it('neither container verb needs a project (they act on the host)', function() {
            assert.equal(needsProject('container:ps'), false);
            assert.equal(needsProject('container:stop'), false);
        });

        it('the anchored exemption does NOT leak to a lookalike task', function() {
            assert.equal(needsProject('container:rm'), true, 'an unshipped verb is not pre-exempted');
            assert.equal(needsProject('project:stop'), true);
            assert.equal(needsProject('bundle:stop'), true);
        });

        // SUBTRACT — without the clause these verbs would demand a project they
        // have no concept of. The failure is cwd-dependent, and its INSIDE-a-
        // project branch is the dangerous one: helper.js silently adopts the cwd
        // folder as the project instead of erroring (the #B69 class).
        it('SUBTRACT: without the exemption clause, both container verbs would demand a project', function() {
            var withoutClause = function(task) {
                return !/\:list$/.test(task)
                    && !/^project\:status$/.test(task)
                    && !/^image\:rm$/.test(task)
                    && !/^image\:run$/.test(task);
            };
            assert.equal(withoutClause('container:ps'), true);
            assert.equal(withoutClause('container:stop'), true);
        });
    });

    // -----------------------------------------------------------------------
    // (f) arguments.json
    // -----------------------------------------------------------------------
    describe('06 — arguments.json', function() {

        // An unlisted flag is silently routed to cmd.nodeParams (and forwarded
        // to node), so the handler would read `undefined` rather than failing
        // loudly — which is why the set is pinned exactly.
        it('whitelists exactly the container group flag set', function() {
            assert.deepEqual(argsArr, ['--format', '--all', '--time', '--force']);
        });
    });

    // -----------------------------------------------------------------------
    // (g) help.txt
    // -----------------------------------------------------------------------
    describe('07 — help.txt', function() {

        it('documents both actions and their flags', function() {
            assert.ok(helpTxt.indexOf('container:ps') > -1);
            assert.ok(helpTxt.indexOf('container:stop') > -1);
            ['--all', '--time', '--force', '--format=json'].forEach(function(flag) {
                assert.ok(helpTxt.indexOf(flag) > -1, 'help.txt documents ' + flag);
            });
        });

        it('explains the rung — why podman`s own exit code is not enough', function() {
            assert.match(helpTxt, /podman exits 0 whether/);
            assert.match(helpTxt, /137 is\s+128\+SIGKILL/);
        });

        it('states the podman requirement and the build-only-host shape', function() {
            assert.match(helpTxt, /buildah builds images but cannot run\s+them/);
            assert.match(helpTxt, /build-only host/);
        });

        it('states that the host resolution is identical to the image group', function() {
            assert.match(helpTxt, /GINA_CONTAINER_HOST/);
            assert.match(helpTxt, /IDENTICAL to the image group/);
        });
    });
});
