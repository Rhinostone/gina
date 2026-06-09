/**
 * Daemonless full-boot integration test (#B29 regression guard).
 *
 * Boots a freshly scaffolded bundle all the way to a *listening* HTTP server —
 * the one thing source-pin / pure-logic-replica tests structurally cannot check
 * ("the bundle never binds"). This is the gap that let #B29 ship: a bundle whose
 * `connectors.json` is the `bundle:add` scaffold default (`$schema`-only, no real
 * connector) stalled model-load so the server never reached `.listen()`.
 *
 * Unlike test/integration/smoke.test.js (which boots via `gina bundle:start` and
 * therefore needs the framework socket daemon on port 8124 — so it skips in CI),
 * this test uses the daemonless launcher `bin/gina-container`. The whole flow —
 * project:add, bundle:add, the boot, project:rm — runs without the daemon and
 * without sudo (every command except `bundle:start` is allowed offline).
 *
 * Isolation: a throwaway gina home under os.tmpdir(), selected by overriding the
 * child processes' HOME env var (getUserHome() reads $HOME, and bin/cli AND
 * bin/gina-container both derive ~/.gina from it). The real ~/.gina/ is never
 * touched. The home self-bootstraps on first use, so this also runs on a clean
 * CI runner where `npm install --ignore-scripts` skipped post_install.
 *
 * The KEY assertion — the bundle binds its port — is a hard FAIL, because that is
 * exactly the #B29 signal. Only win32 (gina-container is Unix-centric) is a skip.
 *
 * Run standalone:
 *   node --test test/integration/container-boot.test.js
 */

var { describe, it, before, after } = require('node:test');
var assert   = require('node:assert/strict');
var net      = require('net');
var http     = require('http');
var https    = require('https');
var fs        = require('fs');
var os        = require('os');
var path      = require('path');
var { spawnSync, spawn } = require('child_process');


// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

var STAMP      = Date.now();
var FAKE_HOME  = path.join(os.tmpdir(), 'gina-cb-home-' + STAMP);   // $HOME override → <FAKE_HOME>/.gina
var GINA_HOME  = path.join(FAKE_HOME, '.gina');
var PROJ       = 'cb' + STAMP;                                       // valid [a-z0-9_.]+ project name
var BUNDLE     = 'demo';
var PROJ_DIR   = path.join(FAKE_HOME, 'proj');                      // project source tree
var PORT_START = 9700;                                              // high, to avoid the dev's default range

var POLL_TIMEOUT_MS  = 20000;
var POLL_INTERVAL_MS = 300;

var GINA_ROOT = path.resolve(__dirname, '../..');
var CLI       = path.join(GINA_ROOT, 'bin', 'cli');
var CONTAINER = path.join(GINA_ROOT, 'bin', 'gina-container');

// Child-process env: isolate the home via HOME and silence the MQ transport
// (GINA_LOG_STDOUT is the container preset — JSON logs, no port-8125 MQ flow).
var CHILD_ENV = Object.assign({}, process.env, {
    HOME           : FAKE_HOME,
    GINA_LOG_STDOUT: 'true'
});
delete CHILD_ENV.GINA_HOMEDIR;   // must derive from HOME, not inherit the dev's value

// State shared between hooks and tests
var skip        = false;   // win32 only — graceful, non-failing
var skipReason  = '';
var setupError  = null;    // a real setup failure → surfaced as a test FAILURE
var bundlePort  = null;
var scheme      = 'http';
var webroot     = '/' + BUNDLE + '/';
var connectorsKeys = null;
var containerProc  = null;
var containerLog   = '';
var containerExit  = null;  // { code, signal } if the launcher exits before we tear it down


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTcpPortOpen(port) {
    return new Promise(function(resolve) {
        var sock = new net.Socket();
        sock.setTimeout(800);
        sock.on('connect', function() { sock.destroy(); resolve(true);  });
        sock.on('error',   function() { resolve(false); });
        sock.on('timeout', function() { sock.destroy(); resolve(false); });
        sock.connect(port, '127.0.0.1');
    });
}

function waitForPort(port, timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    return new Promise(function(resolve) {
        (function poll() {
            isTcpPortOpen(port).then(function(open) {
                if (open)                   return resolve(true);
                if (Date.now() >= deadline) return resolve(false);
                setTimeout(poll, POLL_INTERVAL_MS);
            });
        })();
    });
}

function httpGet(useScheme, port, reqPath) {
    var lib = (useScheme === 'https') ? https : http;
    return new Promise(function(resolve) {
        var req = lib.request({
            host: '127.0.0.1', port: port, path: reqPath,
            method: 'GET', rejectUnauthorized: false
        }, function(res) {
            var body = '';
            res.on('data', function(chunk) { body += chunk; });
            res.on('end',  function() {
                resolve({
                    status:      res.statusCode,
                    contentType: res.headers['content-type'] || '',
                    body:        body
                });
            });
        });
        req.on('error', function(e) { resolve({ status: null, err: e.message, body: '' }); });
        req.end();
    });
}

// Runs an offline gina CLI command against the isolated home.
// Returns { status, stdout, stderr }. status is NOT trusted by callers — the
// first-run home bootstrap exits non-zero on a benign in-process MQ ECONNRESET
// teardown, so success is verified via the on-disk state files instead.
function runCli(args) {
    var r = spawnSync(process.execPath, [CLI].concat(args), {
        env: CHILD_ENV, encoding: 'utf8', timeout: 60000
    });
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

function isChildAlive(child) {
    return child && child.exitCode === null && child.signalCode === null;
}

function readJSON(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Strips full-line `//` comments (gina config JSON allows them) then parses.
// Leaves `//` inside string values (e.g. the https:// $schema URL) intact, since
// only lines whose first non-whitespace is `//` are removed.
function parseConfigJSON(file) {
    var stripped = fs.readFileSync(file, 'utf8')
        .split('\n')
        .filter(function(line) { return !/^\s*\/\//.test(line); })
        .join('\n');
    return JSON.parse(stripped);
}


// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('20 - container-boot — daemonless gina-container boots a default ($schema-only) bundle to a listening server (#B29 guard)', function() {

    before(async function() {

        // gina-container is Unix-centric; skip on Windows.
        if (process.platform === 'win32') {
            skip = true;
            skipReason = 'gina-container is Unix-centric (win32 not supported)';
            return;
        }

        fs.mkdirSync(PROJ_DIR, { recursive: true });

        // 1. project:add — bootstraps the isolated home on first use. The bootstrap
        //    command may exit non-zero (benign MQ ECONNRESET); verify via projects.json.
        runCli(['project:add', '@' + PROJ, '--path=' + PROJ_DIR, '--start-port-from=' + PORT_START]);
        var projectsPath = path.join(GINA_HOME, 'projects.json');
        if (!fs.existsSync(projectsPath) || !readJSON(projectsPath)[PROJ]) {
            setupError = 'project:add did not register @' + PROJ + ' in ' + projectsPath;
            return;
        }

        // 2. bundle:add — scaffolds src/<bundle> keeping the DEFAULT $schema-only
        //    connectors.json (the #B29 trigger). Verify via ports.reverse.json.
        runCli(['bundle:add', BUNDLE, '@' + PROJ]);
        var portsReversePath = path.join(GINA_HOME, 'ports.reverse.json');
        var key = BUNDLE + '@' + PROJ;
        if (!fs.existsSync(portsReversePath) || !readJSON(portsReversePath)[key]) {
            setupError = 'bundle:add did not register ' + key + ' in ports.reverse.json';
            return;
        }

        // 3. Record the scaffolded connectors.json shape (proves the #B29 precondition).
        try {
            var connPath = path.join(PROJ_DIR, 'src', BUNDLE, 'config', 'connectors.json');
            connectorsKeys = Object.keys(parseConfigJSON(connPath));
        } catch (e) {
            setupError = 'could not parse scaffolded connectors.json: ' + (e.message || e);
            return;
        }

        // 4. Resolve the bound port (mirrors core/gna.js) + the public webroot.
        var projects     = readJSON(projectsPath);
        var portsReverse  = readJSON(portsReversePath);
        var pe    = projects[PROJ];
        var env   = pe.def_env || 'dev';
        scheme    = pe.def_scheme || 'http';
        var proto = pe.def_protocol;
        try {
            bundlePort = portsReverse[key][env][proto][scheme];
        } catch (e) { bundlePort = null; }
        if (!bundlePort) {
            setupError = 'could not resolve bound port for ' + key + ' (' + env + '/' + proto + '/' + scheme + ')';
            return;
        }
        try {
            var ssj = fs.readFileSync(path.join(PROJ_DIR, 'src', BUNDLE, 'config', 'settings.server.json'), 'utf8');
            var wr  = (ssj.match(/"webroot"\s*:\s*"([^"]*)"/) || [])[1] || ('/' + BUNDLE);
            webroot = wr.replace(/\/+$/, '') + '/';
        } catch (e) { webroot = '/' + BUNDLE + '/'; }

        // 5. Boot the bundle via the daemonless foreground launcher.
        containerProc = spawn(process.execPath, [CONTAINER, BUNDLE, '@' + PROJ], {
            env: CHILD_ENV, stdio: ['ignore', 'pipe', 'pipe']
        });
        containerProc.stdout.on('data', function(d) { containerLog += d; });
        containerProc.stderr.on('data', function(d) { containerLog += d; });
        containerProc.on('exit', function(code, signal) { containerExit = { code: code, signal: signal }; });
    });


    after(async function() {
        // Always runs — tear down in reverse order, best-effort.
        if (isChildAlive(containerProc)) {
            try { containerProc.kill('SIGTERM'); } catch (e) { /* ignore */ }
            // Idle bundle drains immediately; poll up to ~3 s, then hard-kill.
            var until = Date.now() + 3000;
            while (Date.now() < until && isChildAlive(containerProc)) {
                await sleep(150);
            }
            if (isChildAlive(containerProc)) {
                try { containerProc.kill('SIGKILL'); } catch (e) { /* ignore */ }
            }
        }
        try { runCli(['project:rm', '@' + PROJ, '--force']); } catch (e) { /* ignore */ }
        try { fs.rmSync(FAKE_HOME, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    });


    // -- Tests --

    it('scaffold keeps the default no-connector connectors.json (the #B29 precondition)', function(t) {
        if (skip) { t.skip(skipReason); return; }
        assert.equal(setupError, null, 'setup failed: ' + setupError);
        assert.deepEqual(
            connectorsKeys, ['$schema'],
            'expected the scaffolded connectors.json to declare ONLY $schema (no real connector — the #B29 case), got: ' +
            JSON.stringify(connectorsKeys)
        );
    });

    it('gina-container binds the bundle port within 20 s (#B29 guard — a stalled model-load never listens)', { timeout: POLL_TIMEOUT_MS + 6000 }, async function(t) {
        if (skip) { t.skip(skipReason); return; }
        assert.equal(setupError, null, 'setup failed: ' + setupError);
        assert.ok(bundlePort, 'bundle port not resolved');

        var opened = await waitForPort(bundlePort, POLL_TIMEOUT_MS);
        assert.ok(
            opened,
            'port ' + bundlePort + ' did not open within ' + POLL_TIMEOUT_MS + ' ms — the bundle never reached .listen() ' +
            '(this is the #B29 signature: a $schema-only connectors.json stalling model-load).\n' +
            'container exit: ' + JSON.stringify(containerExit) + '\n' +
            'container log tail:\n' + containerLog.split('\n').slice(-15).join('\n')
        );
    });

    it('GET <webroot> returns 200 with the bundle greeting', { timeout: 8000 }, async function(t) {
        if (skip) { t.skip(skipReason); return; }
        assert.equal(setupError, null, 'setup failed: ' + setupError);
        assert.ok(bundlePort, 'bundle port not resolved');

        var result = await httpGet(scheme, bundlePort, webroot);
        assert.equal(
            result.status, 200,
            'expected HTTP 200 from ' + scheme + '://127.0.0.1:' + bundlePort + webroot + ', got ' +
            result.status + (result.err ? ' (' + result.err + ')' : '')
        );
        assert.ok(
            result.body.indexOf('Hello World') > -1,
            'expected the default greeting ("Hello World !") in the response body.\n' +
            'content-type: ' + result.contentType + '\nfirst 200 chars: ' + result.body.substring(0, 200)
        );
    });

});
