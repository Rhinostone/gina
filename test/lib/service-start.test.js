/**
 * lib/cmd/service/start.js — start a framework-internal @gina service via the
 * daemon-free bin/gina-container launcher, plus the gna.js dev-only auto-start
 * hook (#INS8).
 *
 * Source-inspection tests matching the service-list.test.js / minion-kill.test.js
 * precedent: start.js runs inside the CLI daemon context (CmdHelper, project
 * registry, globals injected by gna.js) and spawns a detached child, so
 * replicating it live is heavy + unsafe for a unit test. These assertions prove
 * the source structure of:
 *
 *   (a) module shape + CmdHelper wiring
 *   (b) argv loop — service positional, @gina-only, --format, --dry-run
 *   (c) manifest lookup — projects.json → gina.path + /manifest.json, .bundles,
 *       unknown-service guard
 *   (d) srcExists guard — existsSync(ginaProject.path + '/' + src)
 *   (e) not-running guard — fmt.readPidfile (already-running → no-op exit 0)
 *   (f) gina-container spawn — process.execPath + GINA_DIR/bin/gina-container,
 *       detached + unref, env scrub (drops NODE_* identity vars)
 *   (g) --dry-run preview (no spawn) + JSON output shape
 *   (h) help.txt documents the start action + --dry-run
 *
 * Section 09 is a pure-logic replica of the start/no-op decision + the env
 * scrub. Section 10 pins + replicates the gna.js server.on('started') auto-start
 * gate (isDev && projectName !== 'gina' && srcExists && !running). The source
 * pins lock the operators so the replicas cannot silently drift.
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var START_SOURCE = path.join(require('../fw'), 'lib/cmd/service/start.js');
var HELP_TXT     = path.join(require('../fw'), 'lib/cmd/service/help.txt');
var GNA_SOURCE   = path.join(require('../fw'), 'core/gna.js');

var src     = fs.readFileSync(START_SOURCE, 'utf8');
var helpTxt = fs.readFileSync(HELP_TXT, 'utf8');
var gnaSrc  = fs.readFileSync(GNA_SOURCE, 'utf8');


// ---------------------------------------------------------------------------
// 01 — Module shape
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('exports the Start constructor', function () {
        assert.match(src, /module\.exports\s*=\s*Start;?/);
    });

    it('declares a function Start(opt, cmd)', function () {
        assert.match(src, /function\s+Start\s*\(\s*opt\s*,\s*cmd\s*\)\s*\{/);
    });

    it('initialises self with null format, dryRun false, service null', function () {
        assert.match(src, /var self\s*=\s*\{\s*format\s*:\s*null\s*,\s*dryRun\s*:\s*false\s*,\s*service\s*:\s*null\s*\}/);
    });

    it('wires CmdHelper with opt.client and debug flags', function () {
        assert.match(src, /new CmdHelper\(self, opt\.client, \{ port: opt\.debugPort, brkEnabled: opt\.debugBrkEnabled \}\)/);
    });

    it('gates on isCmdConfigured()', function () {
        assert.match(src, /if \(\s*!isCmdConfigured\(\)\s*\) return false;/);
    });

    it('imports the shared status primitive as `var fmt = lib.cmdStatusFormat`', function () {
        assert.match(src, /var fmt\s*=\s*lib\.cmdStatusFormat;/);
    });
});


// ---------------------------------------------------------------------------
// 02 — argv parsing
// ---------------------------------------------------------------------------

describe('02 - argv parsing', function () {

    it('captures --format=<value>', function () {
        assert.match(src, /\/\^\\-\\-format\\=\/\.test\(arg\)/);
        assert.match(src, /self\.format = arg\.split\(\/\\=\/\)\[1\];/);
    });

    it('captures --dry-run as a boolean flag', function () {
        assert.match(src, /\/\^\\-\\-dry\\-run\$\/\.test\(arg\)/);
        assert.match(src, /self\.dryRun = true;/);
    });

    it('rejects any project name other than `gina`', function () {
        assert.match(src, /if \(\s*pname\s*!==\s*'gina'\s*\)/);
        assert.match(src, /`service:start` only targets @gina for now/);
    });

    it('captures the first bare (non-flag) token as the service name', function () {
        assert.match(src, /!\/\^\\-\/\.test\(arg\) && !self\.service/);
        assert.match(src, /self\.service = arg;/);
    });

    it('errors with a usage message when no service is given', function () {
        assert.match(src, /if \(\s*!self\.service\s*\)/);
        assert.match(src, /Usage: gina service:start <service>/);
    });
});


// ---------------------------------------------------------------------------
// 03 — projects.json + manifest reading
// ---------------------------------------------------------------------------

describe('03 - manifest lookup', function () {

    it('loads projects.json from GINA_HOMEDIR', function () {
        assert.match(src, /self\.projects = require\(_\(GINA_HOMEDIR \+ '\/projects\.json'\)\);/);
    });

    it('reads the `gina` entry from the project registry', function () {
        assert.match(src, /self\.projects\['gina'\]/);
    });

    it('errors when @gina is missing', function () {
        assert.match(src, /@gina project is not registered/);
    });

    it('builds the manifest path from gina.path + /manifest.json', function () {
        assert.match(src, /ginaProject\.path \+ '\/manifest\.json'/);
    });

    it('parses the manifest via requireJSON (handles // and /* */ comments)', function () {
        assert.match(src, /manifest = requireJSON\(manifestPath\);/);
    });

    it('pulls services from manifest.bundles', function () {
        assert.match(src, /var services\s*=\s*manifest\.bundles \|\| \{\};/);
    });

    it('errors on an unknown @gina service and lists what is available', function () {
        assert.match(src, /typeof\(services\[self\.service\]\) == 'undefined'/);
        assert.match(src, /Unknown @gina service: /);
        assert.match(src, /Object\.keys\(services\)\.sort\(\)\.join\(', '\)/);
    });
});


// ---------------------------------------------------------------------------
// 04 — srcExists guard
// ---------------------------------------------------------------------------

describe('04 - srcExists guard', function () {

    it('checks the service src on disk via fs.existsSync', function () {
        assert.match(src, /var srcExists\s*=\s*src && fs\.existsSync\(_\(ginaProject\.path \+ '\/' \+ src\)\);/);
    });

    it('errors (nothing to start) when the src is missing — the npm-install no-op', function () {
        assert.match(src, /if \(\s*!srcExists\s*\)/);
        assert.match(src, /src not found at/);
    });
});


// ---------------------------------------------------------------------------
// 05 — not-running guard (already-running → no-op exit 0)
// ---------------------------------------------------------------------------

describe('05 - not-running guard via fmt.readPidfile', function () {

    it('probes run state via fmt.readPidfile (no inline copy)', function () {
        assert.match(src, /fmt\.readPidfile\(/);
        assert.doesNotMatch(src, /var readPidfile = function/);
    });

    it('passes the run directory, the service name, and the @gina project', function () {
        assert.match(src, /fmt\.readPidfile\(GINA_HOMEDIR \+ '\/run', self\.service, 'gina'\)/);
    });

    it('treats an already-running service as a no-op (success)', function () {
        assert.match(src, /if \(\s*runState\.running\s*\)/);
        assert.match(src, /is already running/);
        assert.match(src, /reason:\s*'already-running'/);
    });
});


// ---------------------------------------------------------------------------
// 06 — gina-container spawn
// ---------------------------------------------------------------------------

describe('06 - daemon-free gina-container spawn', function () {

    it('resolves GINA_DIR with a __dirname fallback', function () {
        assert.match(src, /var ginaDir\s*=\s*getEnvVar\('GINA_DIR'\) \|\| path\.resolve\(__dirname, '\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/'\);/);
    });

    it('targets bin/gina-container and guards its existence', function () {
        assert.match(src, /var container\s*=\s*ginaDir \+ '\/bin\/gina-container';/);
        assert.match(src, /if \(\s*!fs\.existsSync\(container\)\s*\)/);
        assert.match(src, /gina-container launcher not found/);
    });

    it('scrubs the caller bundle-identity env vars before spawning', function () {
        assert.match(src, /var childEnv\s*=\s*Object\.assign\(\{\}, process\.env\);/);
        assert.match(src, /delete childEnv\.NODE_ENV;/);
        assert.match(src, /delete childEnv\.NODE_SCOPE;/);
        assert.match(src, /delete childEnv\.NODE_PORT;/);
        assert.match(src, /delete childEnv\.NODE_BUNDLE;/);
        assert.match(src, /delete childEnv\.NODE_PROJECT;/);
    });

    it('spawns node + gina-container <service> @gina detached and unref\'d', function () {
        assert.match(src, /spawn\(process\.execPath, \[container, self\.service, '@gina'\], \{/);
        assert.match(src, /detached:\s*true,/);
        assert.match(src, /stdio:\s*'ignore',/);
        assert.match(src, /env:\s*childEnv/);
        assert.match(src, /child\.unref\(\);/);
    });

    it('wraps the spawn in try/catch and reports a spawn failure', function () {
        assert.match(src, /catch \(spawnErr\)/);
        assert.match(src, /failed to spawn/);
    });
});


// ---------------------------------------------------------------------------
// 07 — dry-run + JSON output
// ---------------------------------------------------------------------------

describe('07 - dry-run + output shape', function () {

    it('previews the launch command on --dry-run without spawning', function () {
        assert.match(src, /if \(\s*self\.dryRun\s*\)/);
        assert.match(src, /would spawn:/);
        // the dry-run branch must return before the real spawn block
        var dryIdx   = src.indexOf('self.dryRun )');
        var spawnIdx = src.indexOf('spawn(process.execPath');
        assert.ok(dryIdx > -1 && spawnIdx > -1 && dryIdx < spawnIdx,
            'dry-run branch should precede the real spawn');
    });

    it('emits machine-readable JSON when --format=json', function () {
        assert.match(src, /\/\^json\?\/\.test\(self\.format\)/);
        assert.match(src, /process\.stdout\.write\(JSON\.stringify\(\{/);
    });

    it('reports the started service with its pid', function () {
        assert.match(src, /service:\s*self\.service,/);
        assert.match(src, /started:\s*true,/);
        assert.match(src, /starting '\+ self\.service \+'@gina/);
    });
});


// ---------------------------------------------------------------------------
// 08 — Help
// ---------------------------------------------------------------------------

describe('08 - help.txt', function () {

    it('documents the start action', function () {
        assert.match(helpTxt, /start <service> \[@gina\]/);
    });

    it('documents the --dry-run option', function () {
        assert.match(helpTxt, /--dry-run/);
    });

    it('notes the daemon-free gina-container launch + bundle:stop teardown', function () {
        assert.match(helpTxt, /gina-container/);
        assert.match(helpTxt, /bundle:stop <service> @gina/);
    });

    it('gives a service:start example', function () {
        assert.match(helpTxt, /gina service:start inspector/);
    });
});


// ---------------------------------------------------------------------------
// 09 — Pure-logic replica: command start decision + env scrub
// ---------------------------------------------------------------------------

describe('09 - command decision + env scrub (pure-logic replica)', function () {

    // Mirrors start.js: error when src missing, no-op when already running,
    // otherwise start.
    function decideCommand(srcExists, running) {
        if (!srcExists) return 'error:src-missing';
        if (running)    return 'noop:already-running';
        return 'start';
    }

    // Mirrors the env scrub before spawning gina-container.
    function scrubEnv(env) {
        var e = Object.assign({}, env);
        ['NODE_ENV', 'NODE_SCOPE', 'NODE_PORT', 'NODE_BUNDLE', 'NODE_PROJECT'].forEach(function (k) {
            delete e[k];
        });
        return e;
    }

    it('errors when the service src is missing', function () {
        assert.equal(decideCommand(false, false), 'error:src-missing');
        assert.equal(decideCommand(false, true),  'error:src-missing');
    });

    it('no-ops when the service is already running', function () {
        assert.equal(decideCommand(true, true), 'noop:already-running');
    });

    it('starts when src exists and the service is not running', function () {
        assert.equal(decideCommand(true, false), 'start');
    });

    it('drops the five NODE_* identity vars from the child env', function () {
        var scrubbed = scrubEnv({
            NODE_ENV: 'prod', NODE_SCOPE: 'production', NODE_PORT: '9000',
            NODE_BUNDLE: 'caller', NODE_PROJECT: 'someproj',
            GINA_HOMEDIR: '/home/.gina', GINA_DIR: '/opt/gina', PATH: '/usr/bin'
        });
        assert.equal(scrubbed.NODE_ENV,     undefined);
        assert.equal(scrubbed.NODE_SCOPE,   undefined);
        assert.equal(scrubbed.NODE_PORT,    undefined);
        assert.equal(scrubbed.NODE_BUNDLE,  undefined);
        assert.equal(scrubbed.NODE_PROJECT, undefined);
    });

    it('preserves GINA_* and PATH so gina-container targets the same ~/.gina', function () {
        var scrubbed = scrubEnv({
            NODE_ENV: 'dev', GINA_HOMEDIR: '/home/.gina', GINA_DIR: '/opt/gina', PATH: '/usr/bin'
        });
        assert.equal(scrubbed.GINA_HOMEDIR, '/home/.gina');
        assert.equal(scrubbed.GINA_DIR,     '/opt/gina');
        assert.equal(scrubbed.PATH,         '/usr/bin');
    });
});


// ---------------------------------------------------------------------------
// 10 — gna.js dev auto-start hook (#INS8): source pins + gate replica
// ---------------------------------------------------------------------------

describe('10 - gna.js server.on(\'started\') auto-start hook', function () {

    it('gates on isDev AND projectName !== gina (self-spawn guard)', function () {
        assert.match(gnaSrc, /if \(isDev && projectName !== 'gina'\) \{/);
    });

    it('reads the @gina project and checks services/src/inspector on disk', function () {
        assert.match(gnaSrc, /var _inspProj = projects\['gina'\];/);
        assert.match(gnaSrc, /_inspProj\.path \+ '\/src\/inspector'/);
        assert.match(gnaSrc, /require\('fs'\)\.existsSync\(_inspSrc\)/);
    });

    it('reuses the readPidfile primitive for the not-running guard', function () {
        assert.match(gnaSrc, /lib\.cmdStatusFormat\.readPidfile\(getEnvVar\('GINA_HOMEDIR'\) \+ '\/run', 'inspector', 'gina'\)/);
        assert.match(gnaSrc, /if \(!_inspRun\.running\)/);
    });

    it('spawns the daemon-free gina-container detached + unref\'d', function () {
        assert.match(gnaSrc, /var _inspContainer = getEnvVar\('GINA_DIR'\) \+ '\/bin\/gina-container';/);
        assert.match(gnaSrc, /\[_inspContainer, 'inspector', '@gina'\]/);
        assert.match(gnaSrc, /_inspChild\.unref\(\);/);
    });

    it('scrubs the caller bundle-identity env vars (same shape as the command)', function () {
        assert.match(gnaSrc, /var _inspEnv = Object\.assign\(\{\}, process\.env\);/);
        assert.match(gnaSrc, /delete _inspEnv\.NODE_ENV;/);
        assert.match(gnaSrc, /delete _inspEnv\.NODE_SCOPE;/);
        assert.match(gnaSrc, /delete _inspEnv\.NODE_PORT;/);
        assert.match(gnaSrc, /delete _inspEnv\.NODE_BUNDLE;/);
        assert.match(gnaSrc, /delete _inspEnv\.NODE_PROJECT;/);
    });

    it('is fail-closed (try/catch with a skipped warning)', function () {
        assert.match(gnaSrc, /catch \(inspAutoErr\)/);
        assert.match(gnaSrc, /\[inspector-autostart\] skipped/);
    });

    // Pure-logic replica of the hook gate.
    function shouldAutoStart(isDev, projectName, srcExists, running) {
        return !!(isDev && projectName !== 'gina' && srcExists && !running);
    }

    it('fires only for a dev user bundle with inspector src present + not running', function () {
        assert.equal(shouldAutoStart(true, 'myapp', true, false), true);
    });

    it('never fires outside dev', function () {
        assert.equal(shouldAutoStart(false, 'myapp', true, false), false);
    });

    it('never fires from a @gina service (self-spawn guard)', function () {
        assert.equal(shouldAutoStart(true, 'gina', true, false), false);
    });

    it('never fires when the inspector src is absent (npm install)', function () {
        assert.equal(shouldAutoStart(true, 'myapp', false, false), false);
    });

    it('never fires when the inspector is already running', function () {
        assert.equal(shouldAutoStart(true, 'myapp', true, true), false);
    });
});
